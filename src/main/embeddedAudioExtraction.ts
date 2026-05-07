import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import type { AudioExtractionFormat } from '../shared/types';
import type { Director } from './director';
import { toRendererFileUrl } from './fileUrls';

type EmbeddedAudioExtractionOptions = {
  director: Director;
  getProjectAudioDirectory: () => string | undefined;
  onExtractionStateChanged: () => void;
};

function createExtractionFilePath(visualId: string, format: AudioExtractionFormat, audioDirectory: string | undefined): string {
  if (!audioDirectory) {
    throw new Error('Create a show project before extracting embedded video audio to a file.');
  }
  const safeVisualId = visualId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'visual';
  return path.join(audioDirectory, `${safeVisualId}.${format}`);
}

function getFfmpegPath(): string {
  if (!ffmpegPath) {
    throw new Error('Bundled FFmpeg is unavailable.');
  }
  return ffmpegPath;
}

function summarizeFfmpegError(stderr: string): string {
  const lines = stderr
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const importantLines = lines.filter((line) => /error|invalid|failed|not yet implemented|reserved|sample rate|rematrix/i.test(line));
  return (importantLines.length > 0 ? importantLines : lines.slice(-12)).slice(-20).join('\n');
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(summarizeFfmpegError(stderr) || `FFmpeg exited with code ${code ?? 'unknown'}.`));
    });
  });
}

function createAudioExtractionArgs(inputPath: string, outputPath: string, format: AudioExtractionFormat): string[] {
  const baseArgs = [
    '-y',
    '-fflags',
    '+discardcorrupt',
    '-err_detect',
    'ignore_err',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-ac',
    '2',
    '-ar',
    '48000',
  ];
  return format === 'wav'
    ? [...baseArgs, '-acodec', 'pcm_s16le', outputPath]
    : [...baseArgs, '-acodec', 'aac', '-b:a', '192k', outputPath];
}

export async function extractEmbeddedAudio(
  options: EmbeddedAudioExtractionOptions,
  visualId: string,
  format: AudioExtractionFormat,
): Promise<ReturnType<Director['markEmbeddedAudioExtractionReady']>> {
  const visual = options.director.getState().visuals[visualId];
  if (!visual?.path) {
    throw new Error('This visual has no source file to extract audio from.');
  }
  const outputPath = createExtractionFilePath(visualId, format, options.getProjectAudioDirectory());
  await mkdir(path.dirname(outputPath), { recursive: true });
  const outputUrl = toRendererFileUrl(outputPath);
  options.director.markEmbeddedAudioExtractionPending(visualId, outputPath, outputUrl, format);
  try {
    await runFfmpeg(createAudioExtractionArgs(visual.path, outputPath, format));
    const source = options.director.markEmbeddedAudioExtractionReady(
      visualId,
      outputPath,
      outputUrl,
      format,
      fs.existsSync(outputPath) ? fs.statSync(outputPath).size : undefined,
    );
    options.onExtractionStateChanged();
    return source;
  } catch (error: unknown) {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { force: true });
    }
    const message = error instanceof Error ? error.message : 'Audio extraction failed.';
    const source = options.director.markEmbeddedAudioExtractionFailed(visualId, message);
    options.onExtractionStateChanged();
    throw Object.assign(new Error(message), { source });
  }
}
