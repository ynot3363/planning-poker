import * as React from 'react';
import * as ReactDom from 'react-dom';
import { DisplayMode, Version } from '@microsoft/sp-core-library';
import {
  type IPropertyPaneConfiguration,
  PropertyPaneTextField
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import type { IReadonlyTheme } from '@microsoft/sp-component-base';
import { PlanningPokerStorageService } from '../../storage/planningPokerStorageService';
import { SpHttpTransport } from '../../storage/spHttpTransport';
import type { IPlanningPokerStorageConfiguration } from '../../storage/storageTypes';
import { SHAREPOINT_METADATA_FIELDS } from '../../domain/planningPokerDomain';

import * as strings from 'PlanningPokerWebPartStrings';
import PlanningPoker from './components/PlanningPoker';
import type { IPlanningPokerProps } from './components/PlanningPoker';

/** Defines validated properties persisted with a Planning Poker web-part instance. */
export interface IPlanningPokerWebPartProps {
  /** Searchable plain-text description maintained by page authors. */
  description: string;
  /** The site-scoped storage configuration after successful provisioning. */
  storageConfiguration?: IPlanningPokerStorageConfiguration;
}

/** Initializes SharePoint services and owns the Planning Poker React root. */
export default class PlanningPokerWebPart extends BaseClientSideWebPart<IPlanningPokerWebPartProps> {
  private _storageService: PlanningPokerStorageService | undefined;
  private _theme?: IReadonlyTheme;
  private _storageInitializationError?: string;

  /** @returns `void` after rendering the initialized React tree. */
  public render(): void {
    if (this._storageService === undefined) {
      this.domElement.textContent = 'Planning Poker is still initializing.';
      return;
    }
    const userEmail = this.context.pageContext.user.email.trim();
    const userUpn =
      userEmail.length > 0
        ? userEmail
        : this.context.pageContext.user.loginName.replace(/^.*\|/, '').trim();
    const imageUrl =
      userUpn.length === 0
        ? undefined
        : `${this.context.pageContext.web.absoluteUrl.replace(/\/$/, '')}/_layouts/15/userphoto.aspx?size=S&accountname=${encodeURIComponent(userUpn)}`;
    const element: React.ReactElement<IPlanningPokerProps> = React.createElement(PlanningPoker, {
      storageConfiguration: this.properties.storageConfiguration,
      storageService: this._storageService,
      onStorageConfigured: this.onStorageConfigured,
      isPageEditMode: this.displayMode === DisplayMode.Edit,
      theme: this._theme,
      storageInitializationError: this._storageInitializationError,
      currentUser: {
        displayName: this.context.pageContext.user.displayName,
        upn: userUpn,
        imageUrl
      },
      serviceScope: this.context.serviceScope
    });

    ReactDom.render(element, this.domElement);
  }

  /**
   * Initializes the site-scoped storage service and first-render SharePoint data.
   *
   * @returns A promise that resolves when the web part can render meaningful UI.
   */
  protected async onInit(): Promise<void> {
    await super.onInit();
    const storageService = new PlanningPokerStorageService(
      new SpHttpTransport(this.context.spHttpClient, this.context.pageContext.web.absoluteUrl),
      {
        webAbsoluteUrl: this.context.pageContext.web.absoluteUrl,
        metadataFields: SHAREPOINT_METADATA_FIELDS
      }
    );
    try {
      const saved = await storageService.validateConfiguration(
        this.properties.storageConfiguration
      );
      this.properties.storageConfiguration =
        saved.configuration ?? (await storageService.findConfiguration());
    } catch {
      this._storageInitializationError =
        'Planning Poker storage could not be checked. Verify the SharePoint connection and try again.';
    } finally {
      // Keep render behind discovery so an early host render cannot flash the setup experience.
      this._storageService = storageService;
    }
  }

  /**
   * Applies newly provisioned storage to the current web-part instance.
   *
   * @param configuration - The validated site storage configuration.
   * @returns `void` after re-rendering the configured experience.
   */
  private onStorageConfigured = (configuration: IPlanningPokerStorageConfiguration): void => {
    if (this.displayMode !== DisplayMode.Edit) {
      return;
    }
    this.properties.storageConfiguration = configuration;
    this._storageInitializationError = undefined;
    this.context.propertyPane.refresh();
    this.render();
  };

  /**
   * Synchronizes SharePoint theme changes with React and CSS custom properties.
   *
   * @param currentTheme - The current SharePoint theme, when available.
   * @returns `void` after applying supported semantic colors.
   */
  protected onThemeChanged(currentTheme: IReadonlyTheme | undefined): void {
    if (!currentTheme) {
      return;
    }

    this._theme = currentTheme;
    const { semanticColors } = currentTheme;

    if (semanticColors) {
      this.domElement.style.setProperty('--bodyText', semanticColors.bodyText || null);
      this.domElement.style.setProperty('--link', semanticColors.link || null);
      this.domElement.style.setProperty('--linkHovered', semanticColors.linkHovered || null);
    }
  }

  /** @returns `void` after unmounting the owned React tree. */
  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  /** @returns The current serialized web-part data version. */
  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  /** @returns The authoring controls for editable web-part properties. */
  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: {
            description: strings.PropertyPaneDescription
          },
          groups: [
            {
              groupName: strings.BasicGroupName,
              groupFields: [
                PropertyPaneTextField('description', {
                  label: strings.DescriptionFieldLabel
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
