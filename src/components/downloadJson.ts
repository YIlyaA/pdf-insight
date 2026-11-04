/** Saves text as a .json download through a temporary object URL. */
export function downloadJson(json: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled; some browsers read the URL asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
