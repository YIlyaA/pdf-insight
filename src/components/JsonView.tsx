/** Pretty JSON as a plain text node (never HTML). The surrounding tabpanel is the focusable scroll box. */
export function JsonView({ json }: { json: string }) {
  return <pre className="json">{json}</pre>;
}
