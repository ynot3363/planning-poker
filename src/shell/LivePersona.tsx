import * as React from 'react';
import { Persona, PersonaSize } from '@fluentui/react/lib/Persona';
import { Log } from '@microsoft/sp-core-library';
import type { ServiceScope } from '@microsoft/sp-core-library';
import { SPComponentLoader } from '@microsoft/sp-loader';

/** Identifies SharePoint Online's internal live persona-card component. */
export const LIVE_PERSONA_COMPONENT_ID = '914330ee-2df2-4f6e-a858-30c23a812408';

interface ILivePersonaCardProps {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly clientScenario: string;
  readonly disableHover: boolean;
  readonly hostAppPersonaInfo: { readonly PersonaType: 'User' };
  readonly legacyUpn: string;
  readonly serviceScope: ServiceScope;
  readonly upn: string;
}

interface ILivePersonaComponentModule {
  readonly LivePersonaCard?: React.ComponentType<ILivePersonaCardProps>;
}

/** Defines a resilient Microsoft 365 Persona with optional live-card behavior. */
export interface ILivePersonaProps {
  /** Current user's display name. */
  readonly displayName: string;
  /** Current user's Microsoft 365 user principal name. */
  readonly upn: string;
  /** SharePoint-hosted user photo URL. */
  readonly imageUrl?: string;
  /** SPFx service scope required by the Microsoft 365 live persona card. */
  readonly serviceScope: ServiceScope;
  /** Whether only the user's photo should remain visible. */
  readonly hideDetails?: boolean;
  /** Optional CSS class applied to the Persona and live-card target. */
  readonly className?: string;
}

/**
 * Converts an unknown component-loading failure into a safe diagnostic error.
 *
 * @param error - The value rejected by the SPFx component loader.
 * @returns A non-sensitive error suitable for SPFx diagnostics.
 */
function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error('The Microsoft 365 live persona card failed.');
}

/**
 * Renders the current user's photo and name with a live Microsoft 365 persona card when available.
 *
 * @remarks The live card is an internal SharePoint component, so the visible Persona remains the
 * fallback when that component cannot be loaded in a host.
 * @param props - User identity, photo, layout, and SPFx service-scope values.
 * @returns The Persona, optionally wrapped by the Microsoft 365 live persona card.
 */
export function LivePersona(props: ILivePersonaProps): React.ReactElement {
  const [LivePersonaCard, setLivePersonaCard] =
    React.useState<React.ComponentType<ILivePersonaCardProps>>();

  React.useEffect(() => {
    if (props.upn.length === 0) {
      return undefined;
    }
    let isCurrent = true;
    // eslint-disable-next-line no-void -- The effect handles both promise outcomes and owns cleanup.
    void SPComponentLoader.loadComponentById<ILivePersonaComponentModule>(
      LIVE_PERSONA_COMPONENT_ID
    ).then(
      (module) => {
        if (isCurrent && module.LivePersonaCard !== undefined) {
          setLivePersonaCard(() => module.LivePersonaCard);
        } else if (isCurrent) {
          Log.error(
            'PlanningPoker.LivePersona',
            new Error('The Microsoft 365 live persona component has an incompatible contract.'),
            props.serviceScope
          );
        }
      },
      (error: unknown) => {
        Log.error('PlanningPoker.LivePersona', normalizeError(error), props.serviceScope);
      }
    );
    return (): void => {
      isCurrent = false;
    };
  }, [props.serviceScope, props.upn]);

  const persona = (
    <Persona
      className={props.className}
      text={props.displayName}
      title={props.displayName}
      aria-label={`Signed in as ${props.displayName}`}
      imageUrl={props.imageUrl}
      imageAlt={`${props.displayName}'s profile photo`}
      size={PersonaSize.size32}
      hidePersonaDetails={props.hideDetails}
      showInitialsUntilImageLoads
    />
  );
  if (LivePersonaCard === undefined || props.upn.length === 0) {
    return persona;
  }
  return (
    <LivePersonaCard
      className={props.className}
      clientScenario="livePersonaCard"
      disableHover={false}
      hostAppPersonaInfo={{ PersonaType: 'User' }}
      upn={props.upn}
      legacyUpn={props.upn}
      serviceScope={props.serviceScope}
    >
      <div>{persona}</div>
    </LivePersonaCard>
  );
}
