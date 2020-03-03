import './index.css';
import { DesktopCapturerSource } from 'electron';
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import { constants } from 'fs';

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

    desktopCapturer.getSources({ types: ['window', 'screen'] }).then(async (sources: DesktopCapturerSource[]) => {
        for (const source of sources) {
            console.log(source)
            if (source.name === 'couchstream') {
                navigator.mediaDevices.getUserMedia({
                    audio: {
                      // @ts-ignore
                        mandatory: {
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
                        for (const device of devices) {
                            if (device.deviceId === 'default' && device.kind === "audiooutput") {
                                const systemAudioStream = await navigator.mediaDevices.getUserMedia({
                                    audio: {
                                        deviceId: 'default',
                                        groupId: device.groupId
                                    }
                                })
                                stream.addTrack(systemAudioStream.getAudioTracks()[0])
                            }
                        }
                        handleStream(stream)
                    } catch (e) {
                        handleError(e)
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

async function handleStream (stream: MediaStream) {
  const db = firebase.firestore();
  pc = new RTCPeerConnection(configuration);

  stream.getTracks().forEach((track) => {
    pc.addTrack(track, stream);
  })

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const roomWithOffer = {
    offer: {
      type: offer.type,
      sdp: offer.sdp
    }
  }
  const roomRef = await db.collection('rooms').add(roomWithOffer);
  roomId = roomRef.id;
  document.querySelector('#room').innerHTML =  `<b>Room:</b> ${roomId}`

  const callerCandidatesCollection = roomRef.collection('callerCandidates');

  pc.addEventListener('icecandidate', event => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    callerCandidatesCollection.add(event.candidate.toJSON());
  });

  roomRef.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data.answer) {
      const answer = new RTCSessionDescription(data.answer);
      await pc.setRemoteDescription(answer);
    }
  })

  roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

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
  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (pc) {
    pc.close();
  }

  // Delete room on hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      // @ts-ignore
      await candidate.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      // @ts-ignore
      await candidate.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

async function joinRoomById(roomId: string) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);
  remoteStream = new MediaStream();

  if (roomSnapshot.exists) {
    pc = new RTCPeerConnection(configuration);

    const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
    pc.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });

    pc.addEventListener('track', event => {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
    });

    const offer = roomSnapshot.data().offer;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);

    roomRef.collection('callerCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await pc.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });

    videoNode.hidden = false;
    videoNode.srcObject = remoteStream;
    hangupBtn.hidden = false;
  }
}

function handleError(e: any) {
    console.log(e)
}
