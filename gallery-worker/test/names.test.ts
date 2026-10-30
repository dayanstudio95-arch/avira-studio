import { describe, expect, it } from 'vitest';
import { withAmpersand } from '../shared/names';

describe('couple names with &', () => {
  it('turns the joined ו into &', () => {
    expect(withAmpersand('דניאל וסבינה')).toBe('דניאל & סבינה');
    expect(withAmpersand('הדר ואלירז')).toBe('הדר & אלירז');
    expect(withAmpersand('  מאיה   וקובי ')).toBe('מאיה & קובי');
  });
  it('handles a separate ו and multi-word first names', () => {
    expect(withAmpersand('דניאל ו סבינה')).toBe('דניאל & סבינה');
    expect(withAmpersand('בר אל ומור')).toBe('בר אל & מור');
  });
  it('keeps one ו of names that start with ו', () => {
    expect(withAmpersand('דניאל וורד')).toBe('דניאל & ורד');
    expect(withAmpersand('ויקי ואלון')).toBe('ויקי & אלון');
  });
  it('leaves single names, English, and names that already have & alone', () => {
    expect(withAmpersand('רוני')).toBe('רוני');
    expect(withAmpersand('Roni & Raz')).toBe('Roni & Raz');
    expect(withAmpersand('רוני & רז')).toBe('רוני & רז');
    expect(withAmpersand('Roni and Raz')).toBe('Roni and Raz');
    expect(withAmpersand('')).toBe('');
  });
  it('a family name that starts with ו is not "and" (P72)', () => {
    expect(withAmpersand('דניאל וייס')).toBe('דניאל וייס');
    expect(withAmpersand('רונית וקנין')).toBe('רונית וקנין');
    expect(withAmpersand('רונית ודניאל וייס')).toBe('רונית & דניאל וייס');
    expect(withAmpersand('דניאל וייס ורונית')).toBe('דניאל וייס & רונית');
    expect(withAmpersand('מיכל ווזנה ואבי וולך')).toBe('מיכל ווזנה & אבי וולך');
  });
});
