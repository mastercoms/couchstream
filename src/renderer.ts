import './index.css';
import { DesktopCapturerSource } from 'electron';
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import 'firebase/functions';

console.log('👋 This message is being logged by "renderer.js", included via webpack');

// Your web app's Firebase configuration
var firebaseConfig = {
  apiKey: "AIzaSyCYXdvB_dMR47pJ7738M7zzN2Eg7ovLw_E",
  authDomain: "couchstream-44159.firebaseapp.com",
  databaseURL: "https://couchstream-44159.firebaseio.com",
  projectId: "couchstream-44159",
  storageBucket: "couchstream-44159.appspot.com",
  messagingSenderId: "85553429708",
  appId: "1:85553429708:web:6eead7d8ec5da0c36b5669"
};
// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// In the renderer process.
const { desktopCapturer } = require('electron')

function displayMessage(message: string) {
    let element = document.querySelector('#message')
    element.innerHTML = message
}

let videoNode = document.querySelector('video')
let hangupBtn: HTMLElement = document.querySelector('#hangupBtn')

function playSelectedFile() {
    let file = this.files[0]
    let type = file.type
    videoNode.hidden = false;
    let canPlay: CanPlayTypeResult = videoNode.canPlayType(type)
    let canPlayString = canPlay.toString()
    let isError = false
    if (!canPlayString) {
        canPlayString = 'no'
        isError = true
    }
    let message = 'Can play type "' + type + '": ' + canPlayString
    displayMessage(message)

    if (isError) {
        return
    }

    videoNode.src = window.URL.createObjectURL(file)

    desktopCapturer.getSources({ types: ['window', 'screen', 'audio', 'tab'] }).then(async (sources: DesktopCapturerSource[]) => {
        console.log(sources);
        for (const source of sources) {
            console.log(source)
            if (source.name === 'couchstream') {
                navigator.mediaDevices.getUserMedia({
                    audio: {
                        // @ts-ignore
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: source.id
                        }
                    },
                    video: {
                      // @ts-ignore
                      mandatory: {
                          chromeMediaSource: 'desktop',
                          chromeMediaSourceId: source.id,
                          minWidth: 1280,
                          maxWidth: 1280,
                          minHeight: 720,
                          maxHeight: 720
                      }
                    }
                }).then(async (stream: MediaStream) => {
                    handleStream(stream)
                }).catch(async (err: any) => {
                    handleError(err)
                    try {
                        // if we failed to get video+audio, then just get desktop audio
                        let stream = await navigator.mediaDevices.getUserMedia({
                            audio: {
                              // @ts-ignore
                              mandatory: {
                                chromeMediaSource: 'desktop'
                            }},
                            video: {
                                // @ts-ignore
                                mandatory: {
                                    chromeMediaSource: 'desktop',
                                    chromeMediaSourceId: source.id,
                                    minWidth: 1280,
                                    maxWidth: 1280,
                                    minHeight: 720,
                                    maxHeight: 720
                                }
                            }
                        })
                        handleStream(stream)
                    } catch (e) {
                        handleError(e)
                        try {
                          // if we failed to get video+audio, then just get system audio
                          let stream = await navigator.mediaDevices.getUserMedia({
                              audio: false,
                              video: {
                                  // @ts-ignore
                                  mandatory: {
                                      chromeMediaSource: 'desktop',
                                      chromeMediaSourceId: source.id,
                                      minWidth: 1280,
                                      maxWidth: 1280,
                                      minHeight: 720,
                                      maxHeight: 720
                                  }
                              }
                          })
                          const devices = await navigator.mediaDevices.enumerateDevices()
                          console.log(devices)
                          for (const device of devices) {
                            if (device.deviceId !== 'default' && device.kind === "audiooutput") {
                                const systemAudioStream = await navigator.mediaDevices.getUserMedia({
                                    audio: {
                                        deviceId: device.deviceId,
                                        groupId: device.groupId
                                    }
                                })
                                console.log(systemAudioStream.getAudioTracks())
                                stream.addTrack(systemAudioStream.getAudioTracks()[0])
                                break;
                            }
                        }
                        handleStream(stream)
                      } catch (e) {
                          handleError(e)
                      }
                    }
                })
                return
            }
        }
    })
}

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

let inputNode = document.querySelector('#fileSelector')
inputNode.addEventListener('change', playSelectedFile, {
    passive: true,
    capture: false
})

let roomId: string = null;
let pc: RTCPeerConnection = null;
let remoteStream: MediaStream = null;
let localStream: MediaStream = null;
let pendingCandidates: RTCIceCandidate[] = []
let localCandidateIds: string[] = []
let remoteCandidateIds: string[] = []

async function handleStream (stream: MediaStream) {
  const db = firebase.firestore();
  console.log('Create PeerConnection with configuration: ', configuration);
  pc = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners();

  localStream = stream;
  remoteStream = new MediaStream();

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  })

  pc.addEventListener('icecandidate', event => {
    if (event.candidate) {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate (before DB connection): ', event.candidate);
      pendingCandidates.push(event.candidate);
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.log('Created offer:', offer);

  const roomWithOffer = {
    offer: {
      type: offer.type,
      sdp: offer.sdp
    }
  }
  const roomRef = await db.collection('rooms').add(roomWithOffer);
  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector('#room').innerHTML =  `<b>Room:</b> ${roomId}`

  await collectIceCandidates(roomRef, pc, 'callerCandidates', 'calleeCandidates', true);

  pc.addEventListener('track', event => {
    console.log('Got remote track:', event.streams[0]);
    event.streams[0].getTracks().forEach(track => {
      console.log('Add a track to the remoteStream:', track);
      remoteStream.addTrack(track);
    });
  });

  roomRef.onSnapshot(async snapshot => {
    console.log('Got updated room:', snapshot.data());
    const data = snapshot.data();
    if (data && !pc.currentRemoteDescription && data.answer) {
      console.log('Set remote description: ', data.answer);
      const answer = new RTCSessionDescription(data.answer);
      await pc.setRemoteDescription(answer);
    }
  })

  hangupBtn.hidden = false;
}

document.querySelector('#joinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector<HTMLInputElement>('#roomId').value;
        document.querySelector('#room').innerHTML =  `<b>Room:</b> ${roomId}`
        await joinRoomById(roomId);
      }, {once: true});

hangupBtn.addEventListener('click', hangUp);

async function hangUp() {
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
    });
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (pc) {
    pc.close();
  }

  document.location.reload(true);
}

async function joinRoomById(roomId: string) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  remoteStream = new MediaStream();
  videoNode.srcObject = remoteStream;
  console.log('Stream:', videoNode.srcObject);

  if (roomSnapshot.exists) {
    console.log('Create PeerConnection with configuration: ', configuration);
    pc = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: false
    }).then((stream => {
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream)
      })
    }))

    await collectIceCandidates(roomRef, pc, 'calleeCandidates', 'callerCandidates', false);

    pc.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
    });

    const offer = roomSnapshot.data().offer;
    console.log('Got offer:', offer);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    console.log('Created answer:', answer);
    await pc.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);

    videoNode.hidden = false;
  }
}

function handleError(e: any) {
    console.log(e)
}

function registerPeerConnectionListeners() {
  pc.addEventListener('icegatheringstatechange', () => {
    console.log(
        `ICE gathering state changed: ${pc.iceGatheringState}`);
  });

  pc.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${pc.connectionState}`);
  });

  pc.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${pc.signalingState}`);
  });

  pc.addEventListener('iceconnectionstatechange ', () => {
    console.log(
        `ICE connection state change: ${pc.iceConnectionState}`);
  });
}

async function collectIceCandidates(roomRef: firebase.firestore.DocumentReference, peerConnection: RTCPeerConnection,    
  localName: string, remoteName: string, saveCandidates: boolean) {
  const candidatesCollection = roomRef.collection(localName);

  peerConnection.addEventListener('icecandidate', event => {
    if (event.candidate) {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      const json = event.candidate.toJSON();
      candidatesCollection.add(json).then(doc => {
        if (saveCandidates) {
          localCandidateIds.push(doc.id);
        }
      })
    }
  });

  pendingCandidates.forEach(candidate => {
    console.log('Applying pending candidate: ', candidate);
      const json = candidate.toJSON();
      candidatesCollection.add(json).then(doc => {
        if (saveCandidates) {
          localCandidateIds.push(doc.id);
        }
      })
  });

  roomRef.collection(remoteName).onSnapshot(async snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === "added") {
        let data = change.doc.data();
        if (saveCandidates) {
          remoteCandidateIds.push(change.doc.id);
        }
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        const candidate = new RTCIceCandidate(data);
        await peerConnection.addIceCandidate(candidate);
      }
    });
  })
}

