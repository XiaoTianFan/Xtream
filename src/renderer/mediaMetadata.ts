type AudioTrackDetectableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
  audioTracks?: { length: number };
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
};

export function hasEmbeddedAudioTrack(video: HTMLVideoElement): boolean | undefined {
  const maybeTracks = video as AudioTrackDetectableVideo;
  const capturedStream = captureVideoStream(maybeTracks);
  if (capturedStream) {
    return capturedStream.getAudioTracks().length > 0;
  }
  if (maybeTracks.audioTracks) {
    return maybeTracks.audioTracks.length > 0;
  }
  if (typeof maybeTracks.mozHasAudio === 'boolean') {
    return maybeTracks.mozHasAudio;
  }
  if (typeof maybeTracks.webkitAudioDecodedByteCount === 'number') {
    return maybeTracks.webkitAudioDecodedByteCount > 0;
  }
  return undefined;
}

function captureVideoStream(video: AudioTrackDetectableVideo): MediaStream | undefined {
  try {
    return video.captureStream?.() ?? video.mozCaptureStream?.();
  } catch {
    return undefined;
  }
}
