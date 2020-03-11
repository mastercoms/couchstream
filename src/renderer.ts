import './index.css'
import * as firebase from 'firebase/app'
import 'firebase/firestore'

// Test initial logging
console.log('👋 couchstream says hi!')

// Firebase configuration
var firebaseConfig = {
  apiKey: "AIzaSyCYXdvB_dMR47pJ7738M7zzN2Eg7ovLw_E",
  authDomain: "couchstream-44159.firebaseapp.com",
  databaseURL: "https://couchstream-44159.firebaseio.com",
  projectId: "couchstream-44159",
  storageBucket: "couchstream-44159.appspot.com",
  messagingSenderId: "85553429708",
  appId: "1:85553429708:web:6eead7d8ec5da0c36b5669"
}

// Get video player
let videoNode = document.querySelector('video')

// Button to leave the stream
let leaveStreamBtn: HTMLElement = document.querySelector('#leaveStreamBtn')
leaveStreamBtn.addEventListener('click', hangUp);

// File selector for video and subtitles
let inputNode: HTMLInputElement = document.querySelector('#fileSelector')
inputNode.addEventListener('change', playSelectedFile, {
    passive: true,
    capture: false
})

// WebRTC p2p variables
let roomId: string = null;
let pc: RTCPeerConnection = null;
let remoteStream: MediaStream = null;
let localStream: MediaStream = null;
let pendingCandidates: RTCIceCandidate[] = []
let localCandidateIds: string[] = []
let remoteCandidateIds: string[] = []

// WebRTC stun server config
const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Join the input room, only attempt once
document.querySelector('#joinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector<HTMLInputElement>('#roomId').value;
        document.querySelector('#room').innerHTML =  `<b>Room:</b> ${roomId}`
        await joinRoomById(roomId);
      }, {once: true});

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

function displayMessage(message: string) {
  // Display video play error message
  let element = document.querySelector('#message')
  element.innerHTML = message
}

function playSelectedFile() {
  // Get first file
  let files = inputNode.files
  let file = files[0]
  let vttFile: File = null;
  if (files.length > 1) {
    vttFile = files[1];
  }

  // Check the file type
  let type = file.type
  let canPlay: CanPlayTypeResult = videoNode.canPlayType(type)
  let canPlayString = canPlay.toString()
  let isError = false
  // If we can't play it (empty canPlay), error
  if (!canPlayString) {
      canPlayString = 'no'
      isError = true
  }

  // Show if we can play it or not
  let message = 'Can play type "' + type + '": ' + canPlayString
  displayMessage(message)

  // Don't do anything else if we errored
  if (isError) {
      return
  }

  // Start streaming locally from file to video
  videoNode.src = window.URL.createObjectURL(file)
  videoNode.hidden = false

  // Start the WebRTC stream once we're ready on the local.
  videoNode.oncanplay = () => {
    // Handle captions
    let track = document.createElement("track");
    track.kind = "captions"
    track.label = "Captions"
    track.src = window.URL.createObjectURL(vttFile)
    track.addEventListener("load", () => {
      // @ts-ignore
      track.mode = "showing"
    })
    videoNode.appendChild(track)
    // Handle streaming from the video node
    // @ts-ignore
    handleStream(videoNode.captureStream())
  }
}

function createPeerConnection() {
  // Create peer connection
  console.log('Create PeerConnection with configuration: ', configuration);
  pc = new RTCPeerConnection(configuration);

  // Add peer connection debug logging
  registerPeerConnectionListeners();

  return pc;
}

async function handleStream (stream: MediaStream) {
  // Init DB
  const db = firebase.firestore();
  
  // Create peer connection
  createPeerConnection();

  // Assign to globally accessible stream
  localStream = stream;
  // Init remote stream
  remoteStream = new MediaStream();

  // If we find a candidate before we create a DB entry, queue it up
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate (before DB connection): ', event.candidate);
      pendingCandidates.push(event.candidate);
    }
  };

  // Add local stream tracks to peer connection
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  })

  // Create an offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.log('Created offer:', offer);

  // Create DB document with offer
  const roomWithOffer = {
    offer: {
      type: offer.type,
      sdp: offer.sdp
    }
  }
  const roomRef = await db.collection('rooms').add(roomWithOffer);
  // Document ID is the room ID
  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector('#room').innerHTML =  `<b>Room:</b> ${roomId}`

  // Listen for candidates on the DB
  await collectIceCandidates(roomRef, pc, 'callerCandidates', 'calleeCandidates', true);

  // If we get tracks from remote, add them to our dummy stream
  // We could use this later for voice chat
  pc.addEventListener('track', event => {
    console.log('Got remote track:', event.streams[0]);
    event.streams[0].getTracks().forEach(track => {
      console.log('Add a track to the remoteStream:', track);
      remoteStream.addTrack(track);
    });
  });

  // Room was updated, check if our peer updated the remote description
  roomRef.onSnapshot(async snapshot => {
    console.log('Got updated room:', snapshot.data());
    const data = snapshot.data();
    if (data && !pc.currentRemoteDescription && data.answer) {
      console.log('Set remote description: ', data.answer);
      const answer = new RTCSessionDescription(data.answer);
      await pc.setRemoteDescription(answer);
    }
  })

  // Leave the call
  leaveStreamBtn.hidden = false;
}

async function hangUp() {
  // End local stream
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
    });
  }

  // End stream coming in
  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  // Close peer connection
  if (pc) {
    pc.close();
  }

  // Reload 
  document.location.reload(true);
}

async function joinRoomById(roomId: string) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  // Check if room ID was correct
  if (roomSnapshot.exists) {
    // Create remote stream
    remoteStream = new MediaStream();
    // Video play remote stream
    videoNode.srcObject = remoteStream;
    console.log('Stream:', videoNode.srcObject);
    // Create peer connection
    createPeerConnection();
    // Add dummy stream to peer connection so other side gets something
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: false
    }).then((stream => {
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream)
      })
    }))

    // Listen for candidates on the DB
    await collectIceCandidates(roomRef, pc, 'calleeCandidates', 'callerCandidates', false);

    // Add new tracks to our video element
    pc.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
    });

    // Get offer
    const offer = roomSnapshot.data().offer;
    console.log('Got offer:', offer);
    // Create answer
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    console.log('Created answer:', answer);
    await pc.setLocalDescription(answer);

    // Send answer through DB
    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);

    // Show video and leave call button
    videoNode.hidden = false;
    leaveStreamBtn.hidden = false;
  } else {
    // Bad room, start from beginning
    document.location.reload(true);
  }
}

// Debug logging for peer connection status
function registerPeerConnectionListeners() {
  pc.addEventListener('icegatheringstatechange', () => {
    console.log(`ICE gathering state changed: ${pc.iceGatheringState}`);
  });

  pc.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${pc.connectionState}`);
  });

  pc.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${pc.signalingState}`);
  });

  pc.addEventListener('iceconnectionstatechange ', () => {
    console.log(`ICE connection state change: ${pc.iceConnectionState}`);
  });
}

async function collectIceCandidates(roomRef: firebase.firestore.DocumentReference, peerConnection: RTCPeerConnection,    
  localName: string, remoteName: string, saveCandidates: boolean) {
  const candidatesCollection = roomRef.collection(localName);

  // Replace event listener for ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      const json = event.candidate.toJSON();
      // Add our ICE candidate to the database
      candidatesCollection.add(json).then(doc => {
        // Save candidates, so that the host can clear them all
        if (saveCandidates) {
          localCandidateIds.push(doc.id);
        }
      })
    }
  };

  // Push pending candidates
  pendingCandidates.forEach(candidate => {
    console.log('Applying pending candidate: ', candidate);
      const json = candidate.toJSON();
      // Add our ICE candidate to the database
      candidatesCollection.add(json).then(doc => {
        // Save candidates, so that the host can clear them all
        if (saveCandidates) {
          localCandidateIds.push(doc.id);
        }
      })
  });

  roomRef.collection(remoteName).onSnapshot(async snapshot => {
    snapshot.docChanges().forEach(async change => {
      // If remote added candidates, get them
      if (change.type === "added") {
        let data = change.doc.data();
        // Save candidates, so that the host can clear them all
        if (saveCandidates) {
          remoteCandidateIds.push(change.doc.id);
        }
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        // Add remote ICE candidate
        const candidate = new RTCIceCandidate(data);
        await peerConnection.addIceCandidate(candidate);
      }
    });
  })
}
