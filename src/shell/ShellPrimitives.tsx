import * as React from 'react';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Dialog, DialogFooter, DialogType } from '@fluentui/react/lib/Dialog';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';
import { initializeIcons } from '@fluentui/react/lib/Icons';
import styles from './ApplicationShell.module.scss';

initializeIcons();

/** Defines a page heading and its optional supporting content. */
export interface IPageHeadingProps {
  /** Stable ID used to label the page's main region. */
  readonly id: string;
  /** Visible page title. */
  readonly title: string;
  /** Concise supporting description. */
  readonly description?: string;
  /** Contextual actions associated with the current page. */
  readonly actions?: React.ReactNode;
}

/**
 * Renders the shared page-title and command-area pattern.
 *
 * @param props - Heading content and contextual actions.
 * @returns The page heading.
 */
export function PageHeading(props: IPageHeadingProps): React.ReactElement {
  return (
    <header className={styles.pageHeading}>
      <div className={styles.pageHeadingText}>
        <h1 id={props.id}>{props.title}</h1>
        {props.description !== undefined && <p>{props.description}</p>}
      </div>
      {props.actions !== undefined && <CommandArea>{props.actions}</CommandArea>}
    </header>
  );
}

/** Defines content rendered in the shared command area. */
export interface ICommandAreaProps {
  /** Buttons or controls associated with the current page. */
  readonly children: React.ReactNode;
  /** Accessible name when the surrounding heading does not provide enough context. */
  readonly label?: string;
}

/**
 * Renders a wrapping, right-aligned command area.
 *
 * @param props - Commands and optional accessible label.
 * @returns The grouped command area.
 */
export function CommandArea(props: ICommandAreaProps): React.ReactElement {
  return (
    <div className={styles.commandArea} role="group" aria-label={props.label}>
      {props.children}
    </div>
  );
}

/** Defines content rendered inside a shared surface card. */
export interface IContentCardProps {
  /** Card content. */
  readonly children: React.ReactNode;
  /** Optional accessible label for a standalone card region. */
  readonly label?: string;
  /** Visual intent used without replacing the card's textual meaning. */
  readonly tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
}

/**
 * Renders a theme-aware content card.
 *
 * @param props - Card content, label, and semantic tone.
 * @returns The content card.
 */
export function ContentCard(props: IContentCardProps): React.ReactElement {
  const tone = props.tone ?? 'default';
  return (
    <section
      className={`${styles.contentCard} ${styles[`cardTone${tone}`]}`}
      aria-label={props.label}
    >
      {props.children}
    </section>
  );
}

/** Defines the shared loading, empty, success, warning, and error presentation. */
export interface IStatusStateProps {
  /** Semantic status kind. */
  readonly kind: 'loading' | 'empty' | 'success' | 'warning' | 'error';
  /** Visible status title. */
  readonly title: string;
  /** Visible guidance or explanation. */
  readonly description: string;
  /** Optional action following the guidance. */
  readonly action?: React.ReactNode;
}

/**
 * Renders a consistent status with an appropriate live-region policy.
 *
 * @param props - Status kind, content, and optional action.
 * @returns The accessible status presentation.
 */
export function StatusState(props: IStatusStateProps): React.ReactElement {
  const messageType =
    props.kind === 'error'
      ? MessageBarType.error
      : props.kind === 'warning'
        ? MessageBarType.warning
        : props.kind === 'success'
          ? MessageBarType.success
          : MessageBarType.info;
  return (
    <div
      className={styles.statusState}
      role={props.kind === 'error' ? 'alert' : 'status'}
      aria-live={props.kind === 'error' ? 'assertive' : 'polite'}
    >
      {props.kind === 'loading' && <Spinner size={SpinnerSize.medium} ariaLabel={props.title} />}
      <MessageBar messageBarType={messageType} role="none" delayedRender={false}>
        <strong>{props.title}</strong>
        <span className={styles.statusDescription}>{props.description}</span>
      </MessageBar>
      {props.action !== undefined && <div className={styles.statusAction}>{props.action}</div>}
    </div>
  );
}

/** Defines the shared destructive confirmation contract. */
export interface IDestructiveConfirmationProps {
  /** Whether the modal confirmation is visible. */
  readonly isOpen: boolean;
  /** Confirmation heading. */
  readonly title: string;
  /** Consequence explained before confirmation. */
  readonly message: string;
  /** Destructive action label. */
  readonly confirmLabel: string;
  /** Invoked after explicit destructive confirmation. */
  readonly onConfirm: () => void;
  /** Invoked when the user cancels or dismisses the dialog. */
  readonly onDismiss: () => void;
}

/**
 * Renders an accessible blocking confirmation for destructive operations.
 *
 * @param props - Confirmation state, content, and callbacks.
 * @returns The destructive confirmation dialog.
 */
export function DestructiveConfirmation(props: IDestructiveConfirmationProps): React.ReactElement {
  return (
    <Dialog
      hidden={!props.isOpen}
      onDismiss={props.onDismiss}
      dialogContentProps={{ type: DialogType.normal, title: props.title, subText: props.message }}
      modalProps={{ isBlocking: true }}
    >
      <DialogFooter>
        <PrimaryButton className={styles.destructiveButton} onClick={props.onConfirm}>
          {props.confirmLabel}
        </PrimaryButton>
        <DefaultButton onClick={props.onDismiss}>Cancel</DefaultButton>
      </DialogFooter>
    </Dialog>
  );
}
