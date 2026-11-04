import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/App';
import { baseServices, flush, pdfFile, pendingAnalyze, pick } from '../independent/ui-helpers';

describe('while an analysis is running', () => {
  it('shows no drop zone and no second file picker', async () => {
    const { analyze } = pendingAnalyze();
    const { container } = render(<App services={baseServices({ analyze })} />);
    pick(container, pdfFile());
    await flush();
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeInTheDocument();
    expect(screen.queryByText('Przeciągnij plik PDF tutaj')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wybierz plik' })).toBeNull();
  });

  it('stops the browser from opening a PDF dropped outside the zone', async () => {
    const { analyze } = pendingAnalyze();
    const { container } = render(<App services={baseServices({ analyze })} />);
    pick(container, pdfFile());
    await flush();
    const drop = new Event('drop', { cancelable: true, bubbles: true });
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    const over = new Event('dragover', { cancelable: true, bubbles: true });
    fireEvent(document.body, over);
    expect(over.defaultPrevented).toBe(true);
  });
});
