import type { ComponentPropsWithRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
}

/** Native button with the three variants from the spec. Primary (lime) is used once per screen. */
export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
