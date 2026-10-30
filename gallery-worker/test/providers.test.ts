import { describe, expect, it } from 'vitest';
import { detectLink, driveDownloadUrl, driveWatchUrl, parseDriveLink, parseMyAirBridgeLink } from '../shared/providers';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('Google Drive links', () => {
  it('recognises file links in every common shape', () => {
    for (const url of [
      `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
      `https://drive.google.com/file/d/${ID}/view?usp=drive_link`,
      `https://drive.google.com/file/u/1/d/${ID}/view`,
      `https://drive.google.com/uc?id=${ID}&export=download`,
      `https://drive.usercontent.google.com/download?id=${ID}&export=download`,
    ]) {
      const p = parseDriveLink(url);
      expect(p, url).not.toBeNull();
      expect(p!.kind).toBe('file');
      expect(p!.id).toBe(ID);
      expect(p!.canonical).toBe(`https://drive.google.com/file/d/${ID}/view`);
    }
  });
  it('recognises folder links, including account-numbered ones', () => {
    for (const url of [
      `https://drive.google.com/drive/folders/${ID}?usp=sharing`,
      `https://drive.google.com/drive/u/0/folders/${ID}`,
    ]) {
      const p = parseDriveLink(url)!;
      expect(p.kind).toBe('folder');
      expect(p.canonical).toBe(`https://drive.google.com/drive/folders/${ID}`);
    }
  });
  it('treats open?id= as unknown until asked', () => {
    expect(parseDriveLink(`https://drive.google.com/open?id=${ID}`)?.kind).toBe('unknown');
  });
  it('rejects non-drive or broken links', () => {
    expect(parseDriveLink('https://drive.google.com/drive/my-drive')).toBeNull();
    expect(parseDriveLink('https://example.com/file/d/abc')).toBeNull();
    expect(parseDriveLink('https://drive.google.com/file/d/x/view')).toBeNull();
  });
  it('builds a streaming url with the key and a download url that skips the scan page', () => {
    expect(driveWatchUrl(ID, 'KEY')).toBe(`https://www.googleapis.com/drive/v3/files/${ID}?alt=media&key=KEY`);
    const d = new URL(driveDownloadUrl(ID));
    expect(d.hostname).toBe('drive.usercontent.google.com');
    expect(d.searchParams.get('confirm')).toBe('t');
    expect(d.searchParams.get('export')).toBe('download');
  });
});

describe('MyAirBridge links', () => {
  it('recognises short and full links', () => {
    expect(parseMyAirBridgeLink('https://mab.to/AbC123xyz')?.provider).toBe('myairbridge');
    expect(parseMyAirBridgeLink('https://www.myairbridge.com/en/#!/folder/abc')?.provider).toBe('myairbridge');
    expect(parseMyAirBridgeLink('http://mab.to/AbC123xyz')?.canonical).toBe('https://mab.to/AbC123xyz');
  });
  it('ignores the marketing site and the bare home page', () => {
    expect(parseMyAirBridgeLink('https://info.myairbridge.com/en/api')).toBeNull();
    expect(parseMyAirBridgeLink('https://www.myairbridge.com/')).toBeNull();
  });
});

describe('detectLink', () => {
  it('routes each link to its cloud', () => {
    expect(detectLink('https://www.dropbox.com/scl/fo/abc/def?rlkey=x&dl=0')).toMatchObject({ provider: 'dropbox', kind: 'folder' });
    expect(detectLink(`https://drive.google.com/drive/folders/${ID}`)).toMatchObject({ provider: 'gdrive', kind: 'folder', id: ID });
    expect(detectLink('https://mab.to/AbC123xyz')).toMatchObject({ provider: 'myairbridge' });
    expect(detectLink('https://wetransfer.com/downloads/abc')).toBeNull();
  });
});
