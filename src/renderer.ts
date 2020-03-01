/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';
import { DesktopCapturerSource } from 'electron';
import { constants } from 'fs';

console.log('👋 This message is being logged by "renderer.js", included via webpack');

// In the renderer process.
const { desktopCapturer } = require('electron')

function displayMessage(message: string) {
    let element = document.querySelector('#message')
    element.innerHTML = message
}

function playSelectedFile() {
    let file = this.files[0]
    let type = file.type
    let videoNode = document.querySelector('video')
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
                        mandatory: {
                            chromeMediaSourceId: source.id
                        }
                    },
                    video: {
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

let inputNode = document.querySelector('input')
inputNode.addEventListener('change', playSelectedFile, {
    passive: true,
    capture: false
})

function handleStream (stream: MediaStream) {
    
}

function handleError(e: any) {
    console.log(e)
}
