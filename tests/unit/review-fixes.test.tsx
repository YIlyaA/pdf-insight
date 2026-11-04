import { render, screen } from '@testing-library/react';
import { App } from '../../src/App';
import { AppError } from '../../src/lib/errors';
import { MESSAGES } from '../../src/lib/messages';
import { MAX_FILE_BYTES } from '../../src/lib/validateFile';
import { baseServices, pdfFile, pick } from '../independent/ui-helpers';

describe('too-large message', () => {
  it('never shows the same number for the file and the limit', () => {
    const message = MESSAGES.errTooLarge(MAX_FILE_BYTES + 10, MAX_FILE_BYTES);
    expect(message).toBe('Plik jest za duży (10,1 MB, maks. 10 MB).');
  });

  it('keeps one decimal for ordinary sizes', () => {
    expect(MESSAGES.errTooLarge(12.34 * 1024 * 1024, MAX_FILE_BYTES)).toContain('12,4 MB');
  });
});

describe('offline remapping', () => {
  it.each(['quota_exceeded', 'content_blocked', 'payload_too_large'] as const)(
    'keeps the real cause %s while the device is offline',
    async (code) => {
      const { container } = render(
        <App
          services={baseServices({
            isOnline: () => false,
            analyze: async () => {
              throw new AppError(code);
            },
          })}
        />,
      );
      pick(container, pdfFile());
      await screen.findByRole('alert');
      expect(screen.queryByRole('heading', { level: 2, name: 'Brak połączenia' })).toBeNull();
    },
  );

  it('still reports offline for client timeouts', async () => {
    const { container } = render(
      <App
        services={baseServices({
          isOnline: () => false,
          analyze: async () => {
            throw new AppError('client_timeout');
          },
        })}
      />,
    );
    pick(container, pdfFile());
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Brak połączenia' }),
    ).toBeInTheDocument();
  });
});
