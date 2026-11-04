import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

describe('App', () => {
  it('renders the product name as the main heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'PDF Insight' })).toBeInTheDocument();
  });
});
