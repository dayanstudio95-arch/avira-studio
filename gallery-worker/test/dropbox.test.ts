import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  guessTag,
  isPlayable,
  isVideoFile,
  parseDropboxLink,
  sortByTag,
  titleFromFileName,
  toDownloadUrl,
  toWatchUrl,
} from '../shared/dropbox';

const FOLDER =
  'https://www.dropbox.com/scl/fo/hjecwtz48w4x4cn9fzhhc/APatafn2WmVp90e3_ta1Wvo?rlkey=rt210l0oiiavsf9cple3u8hb7&st=fqtfhm2d&dl=0';
const FILE = 'https://www.dropbox.com/scl/fi/abc123/Highlights%20Roni.mp4?rlkey=key&st=abc&dl=0';
const OLD_FILE = 'https://www.dropbox.com/s/xyz/teaser.mov?dl=0';
const OLD_FOLDER = 'https://www.dropbox.com/sh/xyz/AABBcc?dl=0';

describe('parseDropboxLink', () => {
  it('recognises new folder links and strips dl/st', () => {
    const p = parseDropboxLink(FOLDER)!;
    expect(p.kind).toBe('folder');
    expect(p.canonical).toBe(
      'https://www.dropbox.com/scl/fo/hjecwtz48w4x4cn9fzhhc/APatafn2WmVp90e3_ta1Wvo?rlkey=rt210l0oiiavsf9cple3u8hb7',
    );
  });
  it('recognises new file links with the file name', () => {
    const p = parseDropboxLink(FILE)!;
    expect(p.kind).toBe('file');
    expect(p.name).toBe('Highlights Roni.mp4');
  });
  it('recognises old style links', () => {
    expect(parseDropboxLink(OLD_FILE)?.kind).toBe('file');
    expect(parseDropboxLink(OLD_FOLDER)?.kind).toBe('folder');
  });
  it('rejects non dropbox links and garbage', () => {
    expect(parseDropboxLink('https://drive.google.com/x')).toBeNull();
    expect(parseDropboxLink('not a url')).toBeNull();
    expect(parseDropboxLink('https://www.dropbox.com/home')).toBeNull();
  });
  it('accepts links pasted with spaces around them and dl.dropboxusercontent host', () => {
    expect(parseDropboxLink(`  ${FILE}  `)?.kind).toBe('file');
    expect(parseDropboxLink(FILE.replace('www.dropbox.com', 'dl.dropboxusercontent.com'))?.kind).toBe('file');
  });
});

describe('watch and download urls', () => {
  it('streams from dl.dropboxusercontent.com with raw=1', () => {
    const u = new URL(toWatchUrl(FILE));
    expect(u.hostname).toBe('dl.dropboxusercontent.com');
    expect(u.searchParams.get('raw')).toBe('1');
    expect(u.searchParams.get('dl')).toBeNull();
    expect(u.searchParams.get('rlkey')).toBe('key');
  });
  it('downloads with dl=1 on www.dropbox.com (files and folders)', () => {
    const f = new URL(toDownloadUrl(FILE));
    expect(f.hostname).toBe('www.dropbox.com');
    expect(f.searchParams.get('dl')).toBe('1');
    expect(new URL(toDownloadUrl(FOLDER)).searchParams.get('dl')).toBe('1');
  });
  it('leaves unknown links untouched', () => {
    expect(toWatchUrl('https://example.com/a.mp4')).toBe('https://example.com/a.mp4');
  });
});

describe('film helpers', () => {
  it('guesses tags in Hebrew and English', () => {
    expect(guessTag('Roni & Raz - Highlights.mp4')).toBe('highlights');
    expect(guessTag('הייליטס רוני ורז.mp4')).toBe('highlights');
    expect(guessTag('teaser_final.mp4')).toBe('teaser');
    expect(guessTag('רוני ורז - הסרט המלא.mp4')).toBe('feature');
    expect(guessTag('Full Film.mov')).toBe('feature');
    expect(guessTag('Reels 9x16.mp4')).toBe('reels');
    expect(guessTag('רילס.mp4')).toBe('reels');
    expect(guessTag('חופה.mp4')).toBe('ceremony');
    expect(guessTag('Ceremony.mp4')).toBe('ceremony');
    expect(guessTag('היילייטס.mp4')).toBe('highlights');
    expect(guessTag('סרט.mp4')).toBe('feature');
    expect(guessTag('C0042.MP4')).toBe('other');
  });
  it('reels beats teaser when both words appear', () => {
    expect(guessTag('teaser reels.mp4')).toBe('reels');
  });
  it('knows which files are videos and which play in a browser', () => {
    expect(isVideoFile('a.MP4')).toBe(true);
    expect(isVideoFile('a.jpg')).toBe(false);
    expect(isPlayable('a.mp4')).toBe(true);
    expect(isPlayable('a.mov')).toBe(false);
  });
  it('cleans titles and sorts by tag', () => {
    expect(titleFromFileName('Roni_Raz__Highlights.mp4')).toBe('Roni Raz Highlights');
    const sorted = sortByTag([{ tag: 'reels' as const }, { tag: 'feature' as const }, { tag: 'ceremony' as const }, { tag: 'highlights' as const }]);
    expect(sorted.map((f) => f.tag)).toEqual(['highlights', 'ceremony', 'feature', 'reels']);
  });
  it('formats sizes like the reference site', () => {
    expect(formatBytes(338.2 * 1024 * 1024)).toBe('338.2 MB');
    expect(formatBytes(6.3 * 1024 ** 3)).toBe('6.3 GB');
    expect(formatBytes(0)).toBe('');
  });
});

import { baseTitle, groupVersions, qualityOf } from '../shared/dropbox';

describe('quality versions', () => {
  it('reads the quality from Hebrew and English file names', () => {
    expect(qualityOf('היילייטס 4K.mp4')).toEqual({ height: 2160, label: '4K' });
    expect(qualityOf('היילייטס 1080p.mp4')).toEqual({ height: 1080, label: '1080p' });
    expect(qualityOf('Highlights_4K.mov')?.label).toBe('4K');
    expect(qualityOf('Roni & Raz - Full Film (720p).mp4')?.height).toBe(720);
    expect(qualityOf('Teaser [2160p].mp4')?.label).toBe('4K');
    expect(qualityOf('היילייטס.mp4')).toBeNull();
    // "hd" inside a word is not a quality.
    expect(qualityOf('shadow.mp4')).toBeNull();
    expect(qualityOf('C1080.mp4')).toBeNull();
  });
  it('strips the quality token from the title', () => {
    expect(baseTitle('היילייטס 4K.mp4')).toBe('היילייטס');
    expect(baseTitle('היילייטס - 1080p.mp4')).toBe('היילייטס');
    expect(baseTitle('Highlights_4K.mov')).toBe('Highlights');
    expect(baseTitle('Full Film (720p).mp4')).toBe('Full Film');
    expect(baseTitle('חופה.mp4')).toBe('חופה');
  });
  it('groups the same film across sizes and keeps others apart', () => {
    const files = [
      { fileName: 'היילייטס 1080p.mp4', tag: 'highlights' as const, sizeBytes: 500, playable: true },
      { fileName: 'חופה.mp4', tag: 'ceremony' as const, sizeBytes: 900, playable: true },
      { fileName: 'היילייטס 4K.mp4', tag: 'highlights' as const, sizeBytes: 2000, playable: true },
      { fileName: 'סרט 4K.mov', tag: 'feature' as const, sizeBytes: 9000, playable: false },
    ];
    const g = groupVersions(files);
    expect(g.map((x) => x.title)).toEqual(['היילייטס', 'סרט', 'חופה']);
    expect(g[0].versions.map((v) => v.label)).toEqual(['4K', '1080p']);
    expect(g[0].versions[1].sizeBytes).toBe(500);
    expect(g[2].versions[0].label).toBe('');
  });
});
