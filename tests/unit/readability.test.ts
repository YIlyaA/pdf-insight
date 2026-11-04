// @vitest-environment node
import { keepNumbersTogether } from '../../src/lib/format';
import { SYSTEM_PROMPT } from '../../worker/src/prompt';

const NB = ' ';

describe('keepNumbersTogether', () => {
  it('glues thousands groups and the currency to the number', () => {
    expect(keepNumbersTogether('wynosi 184 500,00 PLN netto')).toBe(
      `wynosi 184${NB}500,00${NB}PLN netto`,
    );
    expect(keepNumbersTogether('od 12 300,00 zł do 13 100,00 zł')).toBe(
      `od 12${NB}300,00${NB}zł do 13${NB}100,00${NB}zł`,
    );
  });

  it('glues "nr" and "r." to their numbers, but leaves ordinary words alone', () => {
    expect(keepNumbersTogether('umowa nr 14/2026 z 12 marca 2026 r. w Gdańsku')).toBe(
      `umowa nr${NB}14/2026 z 12 marca 2026${NB}r. w Gdańsku`,
    );
  });

  it('does not join separate numbers', () => {
    expect(keepNumbersTogether('w 2026 100 osób')).toBe('w 2026 100 osób');
    expect(keepNumbersTogether('24 miesiące')).toBe('24 miesiące');
  });

  it('keeps a text without numbers unchanged', () => {
    expect(keepNumbersTogether('Brak danych')).toBe('Brak danych');
  });
});

describe('prompt: dates need a day', () => {
  it('forbids turning a year or a month alone into day 01', () => {
    expect(SYSTEM_PROMPT).toMatch(/year or month alone/i);
    expect(SYSTEM_PROMPT).toMatch(/never .*01/i);
  });
});
