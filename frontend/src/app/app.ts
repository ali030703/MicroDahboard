// Purpose: Coordinates dashboard generation, chat flow, local UI state, and renderer interactions.
// === FILE DESCRIPTION ===
// Logical entry point of the frontend.
// Runs dashboard generation from prompt via backend and renders the result.

import { Component, OnInit, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ChartPointSelection,
  ChartWidgetModel,
  DashboardChatMessage,
  DashboardChatRole,
  DashboardGenerationMode,
  DashboardGenerationMetadata,
  DashboardGenerationResponse,
  DashboardDatasets,
  DashboardIterationGroup,
  DashboardIterationSnapshot,
  DashboardModel,
  DashboardSessionSnapshot,
  DashboardTemplate,
  DashboardTemplateFamily,
} from './dashboard-engine/models/dashboard.model';

import {
  buildDashboardModel,
  buildDashboardDatasets,
} from './dashboard-engine/builders/dashboard.builder';

import { DashboardEngineModule } from './dashboard-engine/dashboard-engine.module';
import { DashboardApiService } from './dashboard-engine/services/dashboard-api.service';

import {
  DEFAULT_GUIDED_PROMPT_SELECTIONS,
  GuidedPromptSelections,
} from './dashboard-engine/utils/guided-prompt';

import {
  DEFAULT_GRAPH_DRILLDOWN_SELECTIONS,
  buildGraphDrilldownGroups,
  buildGraphDrilldownPreview,
  createGraphDrilldownSelections,
  GraphDrilldownGroup,
  GraphDrilldownGroupKey,
  GraphDrilldownSelections,
} from './dashboard-engine/utils/graph-drilldown';

import {
  buildGenerationPayload,
  createChatMessage,
  createIterationSnapshot,
  normalizeIterationHistory,
  rebuildGenerationGroups,
  resolveIterationRootId,
} from './dashboard-engine/utils/dashboard-workflow';

import { buildPromptBasedIterationLabel } from './dashboard-engine/utils/iteration-label';

import {
  buildDashboardGenerationSummary,
  buildDashboardStatusLabel,
  buildPromptIntentSummary,
  buildSelectedBindingsLabel,
  buildSelectedComponentHint,
  buildSelectedComponentKindLabel,
  buildSourceDescriptor,
} from './dashboard-engine/utils/dashboard-view';

import { applyWidgetCommandPlanToDashboard } from './dashboard-engine/utils/widget-command-editor';
import { parseWidgetCommand } from './dashboard-engine/utils/widget-command';

const API_HOST = typeof window !== 'undefined'
  ? window.location.hostname
  : 'localhost';

const API_PORT = (() => {
  if (typeof window === 'undefined') {
    return '3000';
  }

  const requestedPort = new URLSearchParams(window.location.search).get('apiPort');

  return requestedPort && /^\d{2,5}$/.test(requestedPort)
    ? requestedPort
    : '3000';
})();

const API_BASE_URL = `http://${API_HOST}:${API_PORT}/api`;

const SESSION_STORAGE_KEY = 'microdash-chat-session-id';
const SESSION_GENERATION_MODE: DashboardGenerationMode = 'incremental';
const MAX_STORED_ITERATIONS = 30;

interface GenerateDashboardOptions {
  appendUserMessage?: boolean;
}

interface InvalidPromptFallback {
  title: string;
  message: string;
  suggestions: string[];
  examples: string[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, DashboardEngineModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit {

  // =====================
  // CORE STATE
  // =====================

  dashboardModel: DashboardModel | null = null;
  private dashboardDefinition: DashboardTemplate | null = null;
  generationMetadata: DashboardGenerationMetadata | null = null;

  loading = true;
  error: string | null = null;
  promptFallback: InvalidPromptFallback | null = null;

  // =====================
  // HISTORY STATE
  // =====================

  chatMessages: DashboardChatMessage[] = [];
  chatSessionId = '';

  @ViewChild('chatThread') private chatThread?: ElementRef<HTMLElement>;

  private stickChatToBottom = true;
  private readonly chatAutoScrollThreshold = 72;

  // =====================
  // PROMPT STATE
  // =====================

  generationPrompt = '';
  guidedPromptSelection: GuidedPromptSelections = {
    ...DEFAULT_GUIDED_PROMPT_SELECTIONS,
  };

  private guidedPromptDraft = '';

  templateFamilySelection: '' | DashboardTemplateFamily = 'balanced';
  databasePath = 'backend/sql/microbes.db';

  interactionFeedback = '';
  widgetFeedback = '';

  // =====================
  // SELECTION STATE
  // =====================

  selectedIterationId: string | null = null;
  selectedComponentId: string | null = null;
  focusedComponentId: string | null = null;

  // =====================
  // GRAPH DRILLDOWN STATE
  // =====================

  graphSelection: ChartPointSelection | null = null;

  graphDrilldownSelection: GraphDrilldownSelections = {
    ...DEFAULT_GRAPH_DRILLDOWN_SELECTIONS,
  };

  graphDrilldownGroups: GraphDrilldownGroup[] = [];
  graphDrilldownPreview: ChartWidgetModel | null = null;

  // =====================
  // GENERATION HISTORY
  // =====================

  generationHistory: DashboardIterationSnapshot[] = [];
  generationGroups: DashboardIterationGroup[] = [];

  // =====================
  // CONFIG CONSTANTS
  // =====================

  private static readonly CHART_TEMPLATE_LABELS: Record<string, string> = {
    line: 'line chart',
    bar: 'bar chart',
    'bar-horizontal': 'horizontal bar chart',
    doughnut: 'doughnut chart',
    polar: 'polar chart',
  };

  constructor(
    private readonly api: DashboardApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.bootstrapSession();
  }

  // ============================================================
  // SESSION BOOTSTRAP
  // ============================================================

  private bootstrapSession() {
    const persistedSessionId = this.readSessionIdFromStorage();

    this.api
      .startSession(API_BASE_URL, persistedSessionId || undefined)
      .subscribe({
        next: (snapshot) => {
          this.applySessionSnapshot(snapshot);

          if (snapshot.latestResponse) {
            this.applyGeneratedDashboard(snapshot.latestResponse, false);

            // applyGeneratedDashboard() ends by setting
            // interactionFeedback to the detailed generation summary.
            //
            // During a live generation, generateDashboard() immediately
            // replaces that value with "Dashboard ready." and pushes the
            // detailed summary into chatMessages.
            //
            // The restore path must behave in the same way.
            this.interactionFeedback = 'Dashboard ready.';

            this.loading = false;
            this.cdr.detectChanges();
            return;
          }

          this.loading = false;
          this.cdr.detectChanges();
        },

        error: () => {
          this.chatSessionId = '';
          this.removeSessionIdFromStorage();

          this.pushChatMessage(
            'engine',
            'Session initialization failed. Continuing without saved history.',
          );

          this.loading = false;
          this.cdr.detectChanges();
        },
      });
  }

  /**
   * Rebuilds persisted engine-generation messages using the same
   * detailed summary generator used by the live generation flow.
   *
   * The backend currently persists a generic engine message such as:
   *
   *   Dashboard ready: balanced · organism · avg
   *
   * while the frontend generates the richer:
   *
   *   Built a bar chart showing ...
   *
   * during live generation.
   *
   * Backend generation messages can be identified through their metadata:
   *
   *   Turn X · incremental
   *
   * Other engine messages (for example panel restore/focus messages)
   * do not have this metadata and are therefore left untouched.
   *
   * The turns are sorted chronologically before matching them to the
   * persisted generation messages. This is important because the
   * session snapshot exposes the latest turn first, while chat history
   * is normally chronological.
   */
  private rebuildPersistedChatMessages(
    snapshot: DashboardSessionSnapshot,
  ): DashboardChatMessage[] {
    const generationMessages = snapshot.chatMessages
      .filter((message) => {
        if (message.role !== 'engine' || !message.meta) {
          return false;
        }

        return /^Turn\s+\d+\s+·\s+/i.test(message.meta);
      })
      .sort((a, b) => {
        const turnA = this.extractTurnNumber(a.meta);
        const turnB = this.extractTurnNumber(b.meta);

        return (turnA ?? Number.MAX_SAFE_INTEGER)
          - (turnB ?? Number.MAX_SAFE_INTEGER);
      });

    const chronologicalTurns = [...snapshot.turns]
      .filter((turn) => Boolean(turn.response))
      .sort((a, b) => {
        const dateA = Date.parse(a.createdAt);
        const dateB = Date.parse(b.createdAt);

        if (
          Number.isFinite(dateA) &&
          Number.isFinite(dateB)
        ) {
          return dateA - dateB;
        }

        return 0;
      });

    if (!generationMessages.length || !chronologicalTurns.length) {
      return [...snapshot.chatMessages];
    }

    const replacementByMessageId = new Map<string, string>();

    const pairCount = Math.min(
      generationMessages.length,
      chronologicalTurns.length,
    );

    for (let index = 0; index < pairCount; index += 1) {
      const message = generationMessages[index];
      const turn = chronologicalTurns[index];

      replacementByMessageId.set(
        message.id,
        this.buildGeneratedSummary(
          turn.prompt,
          turn.response,
        ),
      );
    }

    return snapshot.chatMessages.map((message) => {
      const replacement = replacementByMessageId.get(message.id);

      if (replacement === undefined) {
        return message;
      }

      return {
        ...message,
        text: replacement,
      };
    });
  }

  /**
   * Extracts the numeric turn number from backend metadata such as:
   *
   *   Turn 3 · incremental
   */
  private extractTurnNumber(meta: string | undefined): number | null {
    if (!meta) {
      return null;
    }

    const match = meta.match(/^Turn\s+(\d+)\s+·\s+/i);

    if (!match) {
      return null;
    }

    const turnNumber = Number(match[1]);

    return Number.isFinite(turnNumber)
      ? turnNumber
      : null;
  }

  /**
   * Restores the persisted session state.
   *
   * IMPORTANT:
   * chatMessages are not copied blindly from the backend anymore.
   * Generation messages are rebuilt through buildGeneratedSummary()
   * so restored sessions use the same human-readable summaries as
   * live generation.
   */
  private applySessionSnapshot(snapshot: DashboardSessionSnapshot) {
    this.chatSessionId = snapshot.sessionId;
    this.persistSessionId(snapshot.sessionId);

    // Rebuild persisted generation summaries using the same frontend
    // summary logic used by generateDashboard().
    this.chatMessages = this.rebuildPersistedChatMessages(snapshot);

    this.scheduleChatThreadScroll(true);

    this.generationHistory = this.normalizeIterationHistory(
      snapshot.turns,
    );

    this.selectedIterationId = snapshot.turns[0]?.id ?? null;

    const activeTurn = snapshot.turns[0];

    if (activeTurn) {
      this.generationPrompt = activeTurn.prompt;
      this.guidedPromptDraft = activeTurn.prompt;
      this.templateFamilySelection = activeTurn.templateFamily;

      if (activeTurn.databasePath) {
        this.databasePath = activeTurn.databasePath;
      }
    }

    if (!snapshot.latestResponse) {
      this.clearActiveDashboardState();

      this.selectedIterationId = snapshot.turns[0]?.id ?? null;
      this.interactionFeedback = '';
    }

    this.rebuildGenerationGroups(this.selectedIterationId);
  }

  // ============================================================
  // ACTIVE DASHBOARD STATE
  // ============================================================

  private clearActiveDashboardState() {
    this.dashboardModel = null;
    this.dashboardDefinition = null;
    this.generationMetadata = null;
    this.selectedIterationId = null;

    this.clearWidgetSelectionState();
    this.resetGuidedPromptSelection();
  }

  private clearWidgetSelectionState() {
    this.selectedComponentId = null;
    this.focusedComponentId = null;

    this.clearGraphDrilldownState();
    this.widgetFeedback = '';
  }

  // ============================================================
  // GRAPH DRILLDOWN
  // ============================================================

  isGraphDrilldownOptionSelected(
    groupKey: GraphDrilldownGroupKey,
    optionValue: string,
  ) {
    return this.graphDrilldownSelection[groupKey] === optionValue;
  }

  setGraphDrilldownOption(
    groupKey: GraphDrilldownGroupKey,
    optionValue: string,
  ) {
    const group = this.graphDrilldownGroups.find(
      (item) => item.key === groupKey,
    );

    const selectedOption = group?.options.find(
      (item) => item.value === optionValue,
    );

    if (!group || !selectedOption || !this.graphSelection) {
      return;
    }

    this.graphDrilldownSelection = {
      ...this.graphDrilldownSelection,
      [groupKey]: selectedOption.value,
    };

    this.refreshGraphDrilldownPreview();

    this.widgetFeedback = `Drilldown updated: ${selectedOption.label}.`;
  }

  clearGraphSelection() {
    this.clearGraphDrilldownState();

    this.widgetFeedback =
      'Drilldown cleared. Select another chart point to refine the view.';

    this.interactionFeedback = 'Chart drilldown cleared.';
  }

  private resetGuidedPromptSelection() {
    this.guidedPromptSelection = {
      ...DEFAULT_GUIDED_PROMPT_SELECTIONS,
    };

    this.templateFamilySelection = 'balanced';
    this.guidedPromptDraft = '';
    this.generationPrompt = '';
  }

  private refreshGraphDrilldownPreview() {
    const selectedChart = this.graphSelection
      ? this.dashboardModel?.components.find(
          (component): component is ChartWidgetModel =>
            component.id === this.graphSelection?.componentId &&
            component.type === 'chart',
        ) ?? null
      : null;

    this.graphDrilldownPreview = buildGraphDrilldownPreview(
      selectedChart,
      this.graphSelection,
      this.graphDrilldownSelection,
    );

    if (
      this.graphSelection &&
      this.graphDrilldownPreview
    ) {
      this.interactionFeedback =
        `Drilldown preview: ${this.graphDrilldownPreview.description ?? this.graphSelection.pointLabel}`;
    }
  }

  private clearGraphDrilldownState() {
    this.graphSelection = null;

    this.graphDrilldownSelection = {
      ...DEFAULT_GRAPH_DRILLDOWN_SELECTIONS,
    };

    this.graphDrilldownGroups = [];
    this.graphDrilldownPreview = null;
  }

  // ============================================================
  // SESSION STORAGE
  // ============================================================

  private readSessionIdFromStorage() {
    if (typeof window === 'undefined') {
      return '';
    }

    try {
      return window.localStorage.getItem(
        SESSION_STORAGE_KEY,
      ) ?? '';
    } catch {
      return '';
    }
  }

  private persistSessionId(sessionId: string) {
    if (
      typeof window === 'undefined' ||
      !sessionId
    ) {
      return;
    }

    try {
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        sessionId,
      );
    } catch {
      // Ignore storage failures and keep in-memory session only.
    }
  }

  private removeSessionIdFromStorage() {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.removeItem(
        SESSION_STORAGE_KEY,
      );
    } catch {
      // Ignore storage failures.
    }
  }

  // ============================================================
  // DASHBOARD GETTERS
  // ============================================================

  get dashboardStatusLabel() {
    return buildDashboardStatusLabel(
      this.dashboardDefinition,
      this.generationMetadata,
    );
  }

  get generationRules() {
    return this.generationMetadata?.generation.adaptationRules ?? [];
  }

  get changeHints() {
    return this.generationMetadata?.generation.howToChangeDashboard ?? [];
  }

  get renderedComponentsLabel() {
    const componentKinds =
      this.generationMetadata?.generation.renderedComponentKinds ?? [];

    return componentKinds.length
      ? componentKinds.join(' · ')
      : 'No panels available';
  }

  get selectedComponent() {
    return this.dashboardModel?.components.find(
      (component) => component.id === this.selectedComponentId,
    ) ?? null;
  }

  get selectedComponentLabel() {
    return this.selectedComponent?.title ?? 'No panel selected';
  }

  get selectedComponentKindLabel() {
    return buildSelectedComponentKindLabel(
      this.selectedComponent,
    );
  }

  get selectedComponentHint() {
    return buildSelectedComponentHint(
      this.selectedComponent,
    );
  }

  get generationCount() {
    return this.generationGroups.length;
  }

  get activeIteration() {
    return this.generationHistory.find(
      (iteration) => iteration.id === this.selectedIterationId,
    ) ?? null;
  }

  get selectedBindingsLabel() {
    return buildSelectedBindingsLabel(
      this.generationMetadata,
    );
  }

  get sourceDescriptor() {
    return buildSourceDescriptor(
      this.generationMetadata,
    );
  }

  get promptIntentSummary() {
    return buildPromptIntentSummary(
      this.generationMetadata,
    );
  }

  // ============================================================
  // PROMPT ACTIONS
  // ============================================================

  usePromptExample(example: string) {
    this.generationPrompt = example;
    this.guidedPromptDraft = example;

    this.promptFallback = null;
    this.error = null;

    this.dashboardModel = null;
    this.dashboardDefinition = null;
    this.generationMetadata = null;

    this.interactionFeedback =
      'Generating dashboard from selected sample request.';

    this.generateDashboard(example);
  }

  submitChatMessage() {
    const prompt = this.generationPrompt.trim();

    if (!prompt) {
      this.widgetFeedback = this.selectedComponent
        ? 'Enter a panel instruction before applying changes.'
        : 'Enter an analysis request before generating the dashboard.';

      return;
    }

    this.generationPrompt = prompt;

    if (this.selectedComponent) {
      this.applyWidgetCommand(prompt);
      return;
    }

    this.guidedPromptDraft = prompt;
    this.generateDashboard(prompt);
  }

  resetGeneratorInputs() {
    this.resetGuidedPromptSelection();

    this.interactionFeedback = 'Request cleared.';
    this.widgetFeedback = 'Enter a new analysis request.';
  }

  // ============================================================
  // COMPONENT SELECTION
  // ============================================================

  selectDashboardComponent(componentId: string) {
    if (!this.dashboardModel) {
      return;
    }

    this.clearGraphDrilldownState();

    const previousSelectionId = this.selectedComponentId;

    this.selectedComponentId = componentId;

    if (previousSelectionId !== componentId) {
      this.focusedComponentId = null;
    }

    const selectedComponent = this.selectedComponent;

    if (!selectedComponent) {
      this.widgetFeedback = 'Panel selected.';
      return;
    }

    this.widgetFeedback =
      `${selectedComponent.title} selected. ${this.selectedComponentHint}`;
  }

  clearSelectedComponent() {
    this.selectedComponentId = null;
    this.focusedComponentId = null;

    this.clearGraphDrilldownState();

    this.generationPrompt = this.guidedPromptDraft;

    this.widgetFeedback =
      'Selection cleared. Enter a new request to generate a dashboard.';
  }

  focusSelectedWidget() {
    if (!this.selectedComponent) {
      this.widgetFeedback = 'Select a panel first.';
      return;
    }

    this.focusedComponentId = this.selectedComponent.id;

    this.widgetFeedback =
      `Focused view enabled for ${this.selectedComponent.title}.`;
  }

  showAllWidgets() {
    this.focusedComponentId = null;

    if (!this.selectedComponent) {
      this.widgetFeedback = 'Showing the full dashboard.';
      return;
    }

    this.widgetFeedback =
      `Full dashboard restored. ${this.selectedComponent.title} remains selected.`;
  }

  resetSelectedWidget(recordChat = true) {
    const selectedComponent = this.selectedComponent;
    const activeIteration = this.activeIteration;

    if (!selectedComponent || !activeIteration) {
      this.widgetFeedback =
        'Generate a dashboard before restoring a panel.';
      return;
    }

    const preservedComponentId = selectedComponent.id;

    if (recordChat) {
      this.pushChatMessage(
        'user',
        'restore selected panel',
      );
    }

    this.restoreIteration(activeIteration);

    if (
      this.dashboardModel?.components.some(
        (component) => component.id === preservedComponentId,
      )
    ) {
      this.selectedComponentId = preservedComponentId;
    }

    this.focusedComponentId = null;

    this.widgetFeedback =
      `Panel restored to the saved version of ${selectedComponent.title}.`;

    if (recordChat) {
      this.pushChatMessage(
        'engine',
        this.widgetFeedback,
      );
    }
  }

  // ============================================================
  // WIDGET COMMANDS
  // ============================================================

  applyWidgetCommand(commandText: string) {
    const selectedComponent = this.selectedComponent;
    const command = String(commandText || '').trim();

    if (!selectedComponent || !this.dashboardModel) {
      this.widgetFeedback = 'Select a panel first.';
      return;
    }

    if (!command) {
      this.widgetFeedback =
        'Enter a panel instruction before applying changes.';
      return;
    }

    const plan = parseWidgetCommand(command);

    if (!plan.hasAction) {
      this.widgetFeedback =
        'No panel change was detected. Try focus, restore, filter, or change chart type.';
      return;
    }

    this.pushChatMessage('user', command);

    if (plan.showAll) {
      this.showAllWidgets();
      this.pushChatMessage(
        'engine',
        this.widgetFeedback,
      );
      return;
    }

    if (plan.reset) {
      this.resetSelectedWidget(false);
      this.pushChatMessage(
        'engine',
        this.widgetFeedback,
      );
      return;
    }

    const outcome = applyWidgetCommandPlanToDashboard(
      this.dashboardModel,
      selectedComponent.id,
      plan,
    );

    this.dashboardModel = outcome.dashboardModel;

    this.focusedComponentId = plan.focus
      ? selectedComponent.id
      : null;

    if (!outcome.changed && !plan.focus) {
      this.widgetFeedback =
        'No panel change was applied. Try a different instruction or restore the saved version.';

      this.pushChatMessage(
        'engine',
        this.widgetFeedback,
      );

      return;
    }

    this.widgetFeedback = plan.focus
      ? `${outcome.summary} · Focused view enabled for ${selectedComponent.title}.`
      : outcome.summary;

    this.pushChatMessage(
      'engine',
      this.widgetFeedback,
    );
  }

  // ============================================================
  // RESET SESSION
  // ============================================================

  resetConversationSession() {
    if (!this.chatSessionId) {
      this.chatMessages = [];
      this.generationHistory = [];
      this.generationGroups = [];

      this.clearActiveDashboardState();

      this.interactionFeedback =
        'History cleared. Enter a new analysis request.';

      return;
    }

    this.loading = true;
    this.error = null;

    this.api
      .resetSession(
        API_BASE_URL,
        this.chatSessionId,
      )
      .subscribe({
        next: (snapshot) => {
          this.applySessionSnapshot(snapshot);

          this.interactionFeedback =
            'History cleared. Enter a new analysis request.';

          this.loading = false;
          this.cdr.detectChanges();
        },

        error: (err) => {
          this.error =
            err.error?.error ??
            err.message ??
            'Unable to clear history.';

          this.interactionFeedback =
            'History could not be cleared. Try again.';

          this.loading = false;
          this.cdr.detectChanges();
        },
      });
  }

  // ============================================================
  // ITERATION RESTORE / FORK
  // ============================================================

  restoreIteration(iteration: DashboardIterationSnapshot) {
    const preservedSelectionId =
      this.selectedComponentId;

    this.selectedIterationId = iteration.id;
    this.generationPrompt = iteration.prompt;
    this.guidedPromptDraft = iteration.prompt;
    this.templateFamilySelection = iteration.templateFamily;
    this.databasePath = iteration.databasePath;

    this.applyGeneratedDashboard(
      iteration.response,
      false,
    );

    if (
      preservedSelectionId &&
      this.dashboardModel?.components.some(
        (component) => component.id === preservedSelectionId,
      )
    ) {
      this.selectedComponentId = preservedSelectionId;

      const selectedComponent = this.selectedComponent;

      if (selectedComponent) {
        this.widgetFeedback =
          `${selectedComponent.title} selected. ${this.selectedComponentHint}`;
      }
    }

    this.interactionFeedback =
      `Version opened: ${buildPromptBasedIterationLabel(iteration.prompt)}`;
  }

  forkIteration(iteration: DashboardIterationSnapshot) {
    this.restoreIteration(iteration);

    this.interactionFeedback =
      `Version ready for variation: ${buildPromptBasedIterationLabel(iteration.prompt)}`;
  }

  // ============================================================
  // CHART INTERACTION
  // ============================================================

  onChartDataPointSelected(
    selection: ChartPointSelection,
  ) {
    if (
      !selection?.pointLabel ||
      !selection.componentId
    ) {
      return;
    }

    this.selectedComponentId = selection.componentId;
    this.graphSelection = selection;

    this.graphDrilldownSelection =
      createGraphDrilldownSelections(selection);

    this.graphDrilldownGroups =
      buildGraphDrilldownGroups(selection);

    this.refreshGraphDrilldownPreview();

    this.widgetFeedback =
      `Chart point selected: ${selection.pointLabel}. Use the drilldown controls to refine the preview.`;

    this.interactionFeedback =
      `Selected data point: ${selection.pointLabel} · ${selection.componentTitle}`;
  }

  // ============================================================
  // GENERATION PAYLOAD
  // ============================================================

  private buildGenerationPayload(promptOverride?: string) {
    return buildGenerationPayload({
      prompt: promptOverride ?? this.generationPrompt,
      databasePath: this.databasePath,
      templateFamily: this.templateFamilySelection,
      chatSessionId: this.chatSessionId,
      sessionGenerationMode: SESSION_GENERATION_MODE,
    });
  }

  // ============================================================
  // APPLY GENERATED DASHBOARD
  // ============================================================

  private applyGeneratedDashboard(
    response: DashboardGenerationResponse,
    appendHistory = true,
  ) {
    this.clearWidgetSelectionState();

    this.dashboardDefinition =
      response.dashboardDefinition;

    this.generationMetadata =
      response.metadata;

    // Some backend responses wrap datasets under `datasets.dataset`.
    // Ensure we always pass an object shaped like
    // `{ dataset: { ... } }` to the builder.

    let datasetsForBuilder: DashboardDatasets;

    if (response.datasets?.dataset) {
      // Already the expected shape from backend:
      // { datasets: { dataset: { ... } } }
      datasetsForBuilder = response.datasets;
    } else if (response.datasets) {
      // Backend returned a flat bundle
      // (stats, categoryCounts, measureByDimension, preview, etc.)
      datasetsForBuilder =
        buildDashboardDatasets(
          response.datasets as any,
        );
    } else {
      datasetsForBuilder = {
        dataset: {},
      };
    }

    this.dashboardModel =
      buildDashboardModel(
        datasetsForBuilder,
        response.dashboardDefinition,
      );

    if (appendHistory) {
      const parentIterationId =
        response.metadata.session?.continuedFromTurnId ??
        this.selectedIterationId;

      const snapshot =
        createIterationSnapshot(
          response,
          this.generationPrompt.trim(),
          this.databasePath.trim(),
          parentIterationId,
          this.createId.bind(this),
          this.resolveIterationRootId.bind(this),
        );

      this.generationHistory = [
        snapshot,
        ...this.generationHistory,
      ].slice(0, MAX_STORED_ITERATIONS);

      this.selectedIterationId = snapshot.id;
    } else if (response.metadata.session?.turnId) {
      this.selectedIterationId =
        response.metadata.session.turnId;
    }

    this.rebuildGenerationGroups(
      this.selectedIterationId,
    );

    const generatedSummary =
      this.buildGeneratedSummary(
        this.generationPrompt,
        response,
      );

    this.interactionFeedback =
      generatedSummary;
  }

  // ============================================================
  // GENERATION SUMMARY
  // ============================================================

  /**
   * Builds the human-readable
   * "Built a ... for this prompt" summary.
   *
   * IMPORTANT:
   * This intentionally does NOT re-parse `prompt` with local regex.
   *
   * Earlier versions guessed the chart type / metric /
   * microorganism from the raw prompt text with fragile
   * word-matching.
   *
   * Instead we read the values the backend actually resolved
   * and used to generate the dashboard.
   */
  private buildGeneratedSummary(
    prompt: string,
    response: DashboardGenerationResponse,
  ): string {
    const promptIntentMetadata =
      response.metadata?.generation?.promptIntent as
        | {
            chartTemplate?: string | null;

            visualRequests?: Array<{
              chartTemplate?: string | null;
              semanticMetricKey?: string | null;
              semanticMetricKeys?: string[];
              resolvedMeasureColumns?: string[];
              microorganismNames?: string[];
              filters?: Array<{ column?: string; operator?: string; value?: unknown; label?: string; semanticRole?: string }>;
            }>;
            filters?: Array<{ column?: string; operator?: string; value?: unknown; label?: string; semanticRole?: string }>;

            mentionedColumns?: Array<{
              column?: string | null;
              role?: string | null;
            } | null | undefined>;

            microorganismResolution?: {
              matches?: Array<{
                name?: string | null;
              } | undefined>;
            };
          }
        | undefined;

    const mentionedMeasureColumnNames =
      (promptIntentMetadata?.mentionedColumns ?? [])
        .filter(
          (entry) =>
            entry?.role !== 'microorganism' &&
            entry?.role !== 'dimension',
        )
        .map(
          (entry) =>
            entry?.column ?? null,
        );

    return buildDashboardGenerationSummary({
      componentKinds:
        response.metadata?.generation
          ?.renderedComponentKinds ??
        this.dashboardModel?.components.map(
          (component) => component.type,
        ) ??
        [],

      chartTemplate:
        promptIntentMetadata?.chartTemplate ??
        null,

      filters:
        promptIntentMetadata?.filters,

      visualRequests:
        promptIntentMetadata?.visualRequests,

      selectedMetric:
        response.metadata?.generation
          ?.selectedDataBindings
          ?.measureColumn,

      mentionedMeasureColumns:
        mentionedMeasureColumnNames,

      microorganismNames:
        promptIntentMetadata
          ?.microorganismResolution
          ?.matches
          ?.map(
            (match) => match?.name,
          )
          .filter(
            (name): name is string =>
              Boolean(name),
          ) ?? [],
    });
  }

  // ============================================================
  // LABEL HELPERS
  // ============================================================

  private humanizeColumnName(
    columnName: string | null | undefined,
  ): string | null {
    if (!columnName) {
      return null;
    }

    return columnName
      .trim()
      .replace(/\s+/g, ' ');
  }

  getResolvedTableLabel(
    metadata: DashboardGenerationMetadata | null | undefined,
  ) {
    return (
      metadata?.resolvedTable ??
      metadata?.selectedTable ??
      'n/a'
    );
  }

  getGenerationGroupLabel(
    iteration: DashboardIterationSnapshot,
  ) {
    return 'Generation';
  }

  getGenerationVersionLabel(
    iteration: DashboardIterationSnapshot,
    index: number,
    total: number,
  ) {
    if (total <= 1) {
      return 'Version 1';
    }

    if (index === 0) {
      return 'Latest';
    }

    return `Version ${total - index}`;
  }

  private buildCompactIterationLabel(
    iteration: DashboardIterationSnapshot,
  ) {
    const promptLabel =
      buildPromptBasedIterationLabel(
        iteration.prompt,
      );

    const componentKinds =
      iteration.response?.metadata?.generation
        ?.renderedComponentKinds || [];

    const componentLabel =
      this.getCompactComponentLabel(
        componentKinds,
      );

    return [
      promptLabel,
      componentLabel,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  private getCompactComponentLabel(
    componentKinds: Array<string | undefined>,
  ) {
    const normalizedKinds =
      componentKinds
        .filter(
          (kind): kind is string =>
            Boolean(kind),
        )
        .map(
          (kind) =>
            kind.toLowerCase(),
        )
        .filter(
          (kind) =>
            kind !== 'undefined',
        );

    if (!normalizedKinds.length) {
      return '';
    }

    const labelMap: Record<string, string> = {
      chart: 'Chart',
      table: 'Table',
      stats: 'Stats',
    };

    return normalizedKinds
      .map(
        (kind) =>
          labelMap[kind] || kind,
      )
      .join('+');
  }

  // ============================================================
  // CHAT
  // ============================================================

  private pushChatMessage(
    role: DashboardChatRole,
    text: string,
    meta?: string,
  ) {
    const message = createChatMessage(
      role,
      text,
      meta,
    );

    if (!message) {
      return;
    }

    this.chatMessages = [
      ...this.chatMessages,
      message,
    ].slice(-120);

    this.scheduleChatThreadScroll();
  }

  onChatThreadScroll() {
    const container =
      this.chatThread?.nativeElement;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight -
      container.scrollTop -
      container.clientHeight;

    this.stickChatToBottom =
      distanceFromBottom <=
      this.chatAutoScrollThreshold;
  }

  private scheduleChatThreadScroll(
    force = false,
  ) {
    setTimeout(
      () =>
        this.scrollChatThreadToBottom(
          force,
        ),
      0,
    );
  }

  private scrollChatThreadToBottom(
    force = false,
  ) {
    const container =
      this.chatThread?.nativeElement;

    if (!container) {
      return;
    }

    if (
      !force &&
      !this.stickChatToBottom
    ) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: force
        ? 'auto'
        : 'smooth',
    });
  }

  // ============================================================
  // ID / HISTORY HELPERS
  // ============================================================

  private createId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private normalizeIterationHistory(
    turns: DashboardIterationSnapshot[],
  ) {
    return normalizeIterationHistory(
      turns,
      this.resolveIterationRootId.bind(this),
    );
  }

  private resolveIterationRootId(
    iterationId: string,
    iterationMap?: Map<
      string,
      DashboardIterationSnapshot
    >,
    rootCache = new Map<
      string,
      string
    >(),
  ): string {
    const localMap =
      iterationMap ??
      new Map(
        this.generationHistory.map(
          (iteration) => [
            iteration.id,
            iteration,
          ],
        ),
      );

    return resolveIterationRootId(
      iterationId,
      localMap,
      rootCache,
    );
  }

  private rebuildGenerationGroups(
    preferredIterationId: string | null =
      this.selectedIterationId,
  ) {
    this.generationHistory =
      normalizeIterationHistory(
        this.generationHistory,
        this.resolveIterationRootId.bind(this),
      );

    this.generationGroups =
      rebuildGenerationGroups(
        this.generationHistory,
        preferredIterationId,
      );
  }

  // ============================================================
  // GENERATION GROUPS
  // ============================================================

  getSelectedGroupVersion(
    group: DashboardIterationGroup,
  ) {
    return (
      group.versions.find(
        (version) =>
          version.id ===
          group.selectedIterationId,
      ) ??
      group.rootIteration
    );
  }

  loadSelectedGroupVersion(
    group: DashboardIterationGroup,
  ) {
    const selectedVersion =
      this.getSelectedGroupVersion(group);

    if (!selectedVersion) {
      return;
    }

    this.restoreIteration(
      selectedVersion,
    );
  }

  continueSelectedGroupVersion(
    group: DashboardIterationGroup,
  ) {
    const selectedVersion =
      this.getSelectedGroupVersion(group);

    if (!selectedVersion) {
      return;
    }

    this.forkIteration(
      selectedVersion,
    );
  }

  getIterationVersionLabel(
    index: number,
    total: number,
  ) {
    if (total === 1) {
      return 'Inizio';
    }

    if (
      index === 0 &&
      total > 1
    ) {
      return 'Recente';
    }

    if (
      index === total - 1
    ) {
      return 'Inizio';
    }

    return `Versione ${total - index}`;
  }

  // ============================================================
  // GENERATE DASHBOARD
  // ============================================================

  generateDashboard(
    promptOverride?: string,
    options: GenerateDashboardOptions = {},
  ) {
    const prompt =
      (
        promptOverride ??
        this.generationPrompt
      ).trim();

    const appendUserMessage =
      options.appendUserMessage ??
      true;

    if (!prompt) {
      this.interactionFeedback =
        'Enter an analysis request before generating the dashboard.';

      this.loading = false;
      this.cdr.detectChanges();

      return;
    }

    if (appendUserMessage) {
      this.pushChatMessage(
        'user',
        prompt,
      );
    }

    this.loading = true;
    this.error = null;
    this.promptFallback = null;

    const payload =
      this.buildGenerationPayload(
        prompt,
      );

    this.api
      .generateDashboard(
        API_BASE_URL,
        payload,
      )
      .subscribe({
        next: (response) => {
          this.applyGeneratedDashboard(
            response,
          );

          const generationSummary =
            this.interactionFeedback;

          // Keep the compact status outside the chat.
          this.interactionFeedback =
            'Dashboard ready.';

          // Persist/show the detailed summary
          // in the chat.
          this.pushChatMessage(
            'engine',
            generationSummary,
          );

          this.loading = false;
          this.cdr.detectChanges();
        },

        error: (err) => {
          if (err.status === 0) {
            this.error =
              `API unavailable at ${API_BASE_URL}. Start the backend with "npm run start:api" or run "npm run dev".`;

            this.promptFallback = null;
            this.interactionFeedback =
              'API connection unavailable.';
          } else if (
            err.error?.code ===
            'INVALID_PROMPT'
          ) {
            this.error = null;

            this.promptFallback =
              this.normalizeInvalidPromptFallback(
                err.error?.promptHelp,
              );

            this.interactionFeedback =
              'Request needs a clearer analytical intent.';
          } else {
            this.error =
              err.error?.error ??
              err.message ??
              'Unable to generate dashboard.';

            this.promptFallback = null;

            this.interactionFeedback =
              'Generation failed. Review the request and data source, then try again.';
          }

          this.pushChatMessage(
            'engine',
            this.interactionFeedback,
          );

          this.loading = false;
          this.cdr.detectChanges();
        },
      });
  }

  // ============================================================
  // INVALID PROMPT FALLBACK
  // ============================================================

  private normalizeInvalidPromptFallback(
    promptHelp:
      | Partial<InvalidPromptFallback>
      | null
      | undefined,
  ): InvalidPromptFallback {
    return {
      title:
        promptHelp?.title ||
        'Clarify the analysis request',

      message:
        promptHelp?.message ||
        'Specify at least one dataset field, such as a metric or category. You can also include an optional chart type, top-N limit, filter, or sort order.',

      suggestions:
        promptHelp?.suggestions?.length
          ? promptHelp.suggestions
          : [
              'Choose a view type: table, dashboard, bar chart, line chart, doughnut chart, or polar chart.',
              'Add a metric or category: area, solidity, radius, perimeter, eccentricity, filled area, convex area, or microorganism.',
              'Add a limit: top 5, top 10, top 12, or another top-N value.',
              'Add a filter or sort order: between 7 and 10, above 5, below 3, ascending, or descending.',
            ],

      examples:
        promptHelp?.examples?.length
          ? promptHelp.examples
          : [
              'show a dashboard of microorganism categories by area',
              'plot the top 10 records by area',
              'compare average radius and perimeter by microorganism',
              'show records with solidity between 7 and 10',
            ],
    };
  }
}