import * as React from 'react';
import { PrimaryButton } from '@fluentui/react/lib/Button';
import { Icon } from '@fluentui/react/lib/Icon';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import type { IReadonlyTheme } from '@microsoft/sp-component-base';
import type {
  IPlanningPokerStorageConfiguration,
  IStorageProvisioningService
} from '../../../storage/storageTypes';
import styles from './PlanningPoker.module.scss';
import { PlanningPokerThemeProvider } from './PlanningPokerTheme';

/** Defines the dependencies and state supplied by the SPFx web-part boundary. */
export interface IPlanningPokerProps {
  /** The validated storage configuration, when provisioning is complete. */
  readonly storageConfiguration?: IPlanningPokerStorageConfiguration;
  /** The service that performs explicit, user-initiated provisioning. */
  readonly storageService: IStorageProvisioningService;
  /** Applies successfully provisioned storage at the web-part boundary. */
  readonly onStorageConfigured: (configuration: IPlanningPokerStorageConfiguration) => void;
  /** The current SharePoint theme, when supplied by the host. */
  readonly theme?: IReadonlyTheme;
  /** A non-sensitive first-render storage discovery failure. */
  readonly storageInitializationError?: string;
}

/**
 * Renders storage configuration and handles explicit provisioning requests.
 *
 * @param props - Web-part dependencies and initialized state.
 * @returns The configuration experience.
 */
function PlanningPokerContent(props: IPlanningPokerProps): React.ReactElement {
  const [canProvisionStorage, setCanProvisionStorage] = React.useState<boolean>();
  const [isProvisioning, setIsProvisioning] = React.useState(false);
  const [error, setError] = React.useState<string>();

  React.useEffect((): (() => void) | undefined => {
    if (props.storageConfiguration !== undefined) {
      return undefined;
    }
    let isCurrent = true;
    props.storageService.canProvision().then(
      (isAllowed) => {
        if (isCurrent) {
          setCanProvisionStorage(isAllowed);
        }
      },
      () => {
        if (isCurrent) {
          setCanProvisionStorage(false);
          setError('Unable to verify SharePoint provisioning permissions.');
        }
      }
    );
    return (): void => {
      isCurrent = false;
    };
  }, [props.storageConfiguration, props.storageService]);

  /** Performs the user-initiated provisioning request and maps failures to safe UI text. */
  const handleProvision = async (): Promise<void> => {
    setIsProvisioning(true);
    setError(undefined);
    try {
      props.onStorageConfigured(await props.storageService.provision());
    } catch {
      setIsProvisioning(false);
      setError('Storage could not be configured. You can safely try again.');
    }
  };

  if (props.storageConfiguration !== undefined) {
    return (
      <main className={styles.content}>
        <h2>Planning Poker</h2>
        <p>Storage is configured for this web part.</p>
      </main>
    );
  }
  const message = props.storageInitializationError ?? error;
  return (
    <section className={styles.configuration} aria-labelledby="planning-poker-storage">
      <div className={styles.storageGraphic} aria-hidden="true">
        <Icon className={styles.storageIcon} iconName="CloudAdd" />
      </div>
      <div className={styles.configurationBody}>
        <p className={styles.eyebrow}>One-time setup</p>
        <h2 id="planning-poker-storage">Configure Planning Poker storage</h2>
        <p className={styles.description}>
          Planning Poker needs a hidden site library for collaborative data. A site owner with Edit
          permissions must configure it once.
        </p>
        {message !== undefined && (
          <MessageBar messageBarType={MessageBarType.error}>{message}</MessageBar>
        )}
        {canProvisionStorage === false &&
          props.storageInitializationError === undefined &&
          error === undefined && (
            <MessageBar messageBarType={MessageBarType.warning}>
              You need Manage Lists permission to configure Planning Poker storage.
            </MessageBar>
          )}
        <PrimaryButton
          className={styles.configureButton}
          text={isProvisioning ? 'Creating storage...' : 'Create storage'}
          disabled={canProvisionStorage !== true || isProvisioning}
          onClick={handleProvision}
        />
      </div>
    </section>
  );
}

/**
 * Provides the SharePoint theme and renders the Planning Poker root experience.
 *
 * @param props - Web-part dependencies and initialized state.
 * @returns The themed React tree.
 */
export default function PlanningPoker(props: IPlanningPokerProps): React.ReactElement {
  return (
    <PlanningPokerThemeProvider theme={props.theme}>
      <PlanningPokerContent {...props} />
    </PlanningPokerThemeProvider>
  );
}
