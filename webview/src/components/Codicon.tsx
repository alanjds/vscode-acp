import type { JSX } from 'react';

export type CodiconProps = {
  name: string;
  className?: string;
  spin?: boolean;
  title?: string;
};

export function Codicon({ name, className = '', spin = false, title }: CodiconProps): JSX.Element {
  const classes = [
    'codicon',
    `codicon-${name}`,
    spin ? 'codicon-modifier-spin' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <i className={classes} title={title} aria-hidden={title ? undefined : true} />;
}
