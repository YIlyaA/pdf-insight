import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';
import { baseServices } from '../independent/ui-helpers';

// Browsers without HTMLDialogElement.showModal: the dialog falls back to the `open` attribute.
const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
const saved = { showModal: proto.showModal, close: proto.close };

beforeEach(() => {
  delete proto.showModal;
  delete proto.close;
});

afterEach(() => {
  if (saved.showModal) proto.showModal = saved.showModal;
  if (saved.close) proto.close = saved.close;
});

describe('privacy dialog without showModal', () => {
  it('opens with the open attribute and moves focus into the dialog', async () => {
    render(<App services={baseServices()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Prywatność' }));
    const dialog = screen.getByRole('dialog', { name: 'Prywatność i dane' });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Zamknij' })).toHaveFocus();
  });

  it('closes with Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<App services={baseServices()} />);
    const opener = screen.getByRole('button', { name: 'Prywatność' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes with Zamknij and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<App services={baseServices()} />);
    const opener = screen.getByRole('button', { name: 'Prywatność' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
