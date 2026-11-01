import { describe, expect, it } from 'vitest';
import { coupleMatches, withAmpersand } from '../shared/names';

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

describe('the studio finds a couple however the names are typed (Avira, 2026-11-02)', () => {
  it('"דניאלה & דן" is found by "דניאלה ודן", "דן ודניאלה", one name, or part of a name', () => {
    for (const q of ['דניאלה ודן', 'דן ודניאלה', 'דניאלה & דן', 'דן & דניאלה', 'דניאלה', 'דן', 'דני', '  דן   ו דניאלה ']) {
      expect(coupleMatches('דניאלה & דן', q), q).toBe(true);
    }
  });
  it('not another couple, and every typed person counts', () => {
    expect(coupleMatches('דניאלה & דן', 'נועה')).toBe(false);
    expect(coupleMatches('דניאלה & דן', 'דן ונועה')).toBe(false);
    expect(coupleMatches('נועה & תומר', 'דניאלה ודן')).toBe(false);
  });
  it('names stored with ו, English "and", and a family name that starts with ו', () => {
    expect(coupleMatches('מאי ואופק', 'אופק & מאי')).toBe(true);
    expect(coupleMatches('Noa and Tom', 'tom & noa')).toBe(true);
    expect(coupleMatches('רונית & דניאל וייס', 'דניאל וייס ורונית')).toBe(true);
    expect(coupleMatches('דניאלה & דן', '')).toBe(true);
  });
});
