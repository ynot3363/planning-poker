import * as React from 'react';

/** Props for application-role visibility without implying an authorization boundary. */
export interface IRoleGuardProps {
  readonly allowed: boolean;
  readonly children: React.ReactNode;
}

/**
 * Hides capability-specific controls when the current application role does not apply.
 *
 * @remarks Protected mutations must independently recheck authorization at their boundary.
 * @param props - Visibility decision and guarded content.
 * @returns Guarded children or `null`.
 */
export function RoleGuard(props: IRoleGuardProps): React.ReactElement {
  return <>{props.allowed ? props.children : undefined}</>;
}
