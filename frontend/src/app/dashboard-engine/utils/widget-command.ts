// Purpose: Parses natural-language widget edit commands into structured edit plans.
import { ChartWidgetModel } from '../models/dashboard.model';

export type WidgetCommandChartTemplate = ChartWidgetModel['chart']['template'];
export type WidgetCommandSortDirection = 'asc' | 'desc';

export interface WidgetCommandPlan {
  rawCommand: string;
  normalizedCommand: string;
  focus: boolean;
  showAll: boolean;
  reset: boolean;
  chartTemplate: WidgetCommandChartTemplate | null;
  limit: number | null;
  sortDirection: WidgetCommandSortDirection | null;
  filterTokens: string[];
  hasAction: boolean;
  summary: string;
}

const COMMAND_STOP_WORDS = new Set([
  'a',
  'all',
  'also',
  'an',
  'and',
  'around',
  'as',
  'at',
  'be',
  'better',
  'by',
  'can',
  'chart',
  'charts',
  'change',
  'clean',
  'clear',
  'compare',
  'comparison',
    'bar',
    'barchart',
  'could',
  'data',
  'dashboard',
  'dashboards',
  'detail',
  'display',
  'do',
  'each',
  'edit',
  'focus',
  'for',
  'from',
    'donut',
    'doughnut',
    'average',
  'give',
  'go',
  'graph',
  'graphs',
  'graphs',
  'group',
  'groups',
  'hide',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'item',
  'items',
  'just',
  'kind',
    'line',
    'make',
  'kinds',
  'last',
  'limit',
  'line',
  'make',
  'me',
  'more',
  'need',
  'of',
  'on',
  'only',
    'maximum',
    'minimum',
  'please',
  'plot',
  'plots',
  'preview',
    'polar',
  'put',
  'rank',
  'ranking',
  'record',
  'records',
    'radar',
    'ring',
  'reset',
  'row',
  'rows',
    'microbe',
    'microbes',
    'microorganism',
    'microorganisms',
    'organism',
    'organisms',
  'select',
  'selected',
  'show',
  'side',
  'small',
  'sort',
  'stuff',
  'summary',
  'table',
  'tables',
  'that',
  'the',
  'this',
  'those',
  'to',
  'top',
  'trend',
    'time',
    'series',
  'type',
  'types',
    'species',
  'view',
  'visual',
  'want',
  'with',
  'without',
  'would',
  'you',
  'your',
]);

const LIMIT_CUE_WORDS = new Set(['first', 'last', 'limit', 'maximum', 'max', 'show', 'top', 'up']);
const FOCUS_WORDS = new Set(['focus', 'focused', 'isolate', 'isolated', 'solo', 'highlight']);
const RESET_WORDS = new Set(['reset', 'restore', 'clear', 'undo', 'revert', 'back']);
const SORT_ASC_WORDS = new Set(['asc', 'ascending', 'smallest', 'lower', 'low', 'least', 'earliest', 'oldest', 'up']);
const SORT_DESC_WORDS = new Set(['desc', 'descending', 'largest', 'highest', 'high', 'most', 'newest', 'latest', 'down']);
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  twentyone: 21,
  twentytwo: 22,
  twentythree: 23,
  twentyfour: 24,
  twentyfive: 25,
  twentysix: 26,
  twentyseven: 27,
  twentyeight: 28,
  twentynine: 29,
  thirty: 30,
};

function normalizeWidgetText(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[.,;:!?()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeWidgetText(value: string) {
  return normalizeWidgetText(value)
    .split(' ')
    .filter(Boolean);
}

function normalizeCommandTokens(value: string) {
  return tokenizeWidgetText(value);
}

function getNumericToken(tokens: string[]) {
  return tokens.find((token) => /^\d{1,2}$/.test(token)) ?? null;
}

function parseLimit(tokens: string[], normalizedCommand: string) {
  const hasCue = tokens.some((token) => LIMIT_CUE_WORDS.has(token));

  if (!hasCue) {
    return null;
  }

  const numericToken = getNumericToken(tokens);

  if (numericToken) {
    const value = Number(numericToken);
    return Number.isFinite(value) ? value : null;
  }

  const wordToken = tokens.find((token) => Object.prototype.hasOwnProperty.call(WORD_NUMBERS, token));

  if (wordToken) {
    return WORD_NUMBERS[wordToken] ?? null;
  }

  const compactWordMatch = normalizedCommand.replace(/\s+/g, '').match(/(?:top|limit|first|last|show|maximum|max|upto)(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty)/i);

  if (!compactWordMatch?.[1]) {
    return null;
  }

  return WORD_NUMBERS[compactWordMatch[1].toLowerCase()] ?? null;
}

function parseChartTemplate(tokens: string[]): WidgetCommandChartTemplate | null {
  const tokenSet = new Set(tokens);

  if (tokenSet.has('horizontal') || tokenSet.has('sideways') || (tokenSet.has('bar') && tokenSet.has('horizontal'))) {
    return 'bar-horizontal';
  }

  if (tokenSet.has('doughnut') || tokenSet.has('donut') || tokenSet.has('ring')) {
    return 'doughnut';
  }

  if (tokenSet.has('polar') || tokenSet.has('radar') || tokenSet.has('circular')) {
    return 'polar';
  }

  if (tokenSet.has('line') || tokenSet.has('trend') || tokenSet.has('series') || tokenSet.has('time')) {
    return 'line';
  }

  if (tokenSet.has('bar') || tokenSet.has('histogram') || tokenSet.has('column') || tokenSet.has('columns') || tokenSet.has('comparison')) {
    return 'bar';
  }

  return null;
}

function parseSortDirection(tokens: string[]) {
  if (tokens.some((token) => SORT_ASC_WORDS.has(token))) {
    return 'asc';
  }

  if (tokens.some((token) => SORT_DESC_WORDS.has(token))) {
    return 'desc';
  }

  return null;
}

function parseShowAll(tokens: string[]) {
  return (tokens.includes('show') && tokens.includes('all'))
    || (tokens.includes('clear') && tokens.includes('focus'))
    || (tokens.includes('show') && tokens.includes('everything'));
}

function parseFilterTokens(tokens: string[]) {
  return tokens.filter((token) => {
    if (COMMAND_STOP_WORDS.has(token)) {
      return false;
    }

    if (LIMIT_CUE_WORDS.has(token)) {
      return false;
    }

    if (FOCUS_WORDS.has(token) || RESET_WORDS.has(token)) {
      return false;
    }

    if (SORT_ASC_WORDS.has(token) || SORT_DESC_WORDS.has(token)) {
      return false;
    }

    if (/^\d{1,2}$/.test(token)) {
      return false;
    }

    return true;
  });
}

export function normalizeWidgetLabel(value: string) {
  return normalizeWidgetText(value);
}

export function matchesWidgetLabel(label: string, filterTokens: string[]) {
  if (!filterTokens.length) {
    return false;
  }

  const normalizedLabel = normalizeWidgetText(label);
  return filterTokens.some((token) => normalizedLabel.includes(token));
}

export function parseWidgetCommand(command: string): WidgetCommandPlan {
  const rawCommand = String(command || '').trim();
  const normalizedCommand = normalizeWidgetText(rawCommand);
  const tokens = normalizeCommandTokens(rawCommand);
  const chartTemplate = parseChartTemplate(tokens);
  const limit = parseLimit(tokens, normalizedCommand);
  const sortDirection = parseSortDirection(tokens);
  const reset = tokens.some((token) => RESET_WORDS.has(token));
  const focus = tokens.some((token) => FOCUS_WORDS.has(token) || token === 'only');
  const showAll = parseShowAll(tokens);
  const filterTokens = parseFilterTokens(tokens);
  const hasAction = Boolean(chartTemplate || limit || sortDirection || reset || focus || showAll || filterTokens.length);
  const summaryParts: string[] = [];

  if (showAll) {
    summaryParts.push('show full dashboard');
  }

  if (reset) {
    summaryParts.push('restore panel');
  }

  if (chartTemplate) {
    summaryParts.push(`chart type -> ${chartTemplate}`);
  }

  if (limit) {
    summaryParts.push(`limit ${limit}`);
  }

  if (sortDirection) {
    summaryParts.push(`sort ${sortDirection}`);
  }

  if (filterTokens.length) {
    summaryParts.push(`filter ${filterTokens.slice(0, 4).join(', ')}`);
  }

  if (focus) {
    summaryParts.push('focused view');
  }

  return {
    rawCommand,
    normalizedCommand,
    focus,
    showAll,
    reset,
    chartTemplate,
    limit,
    sortDirection,
    filterTokens,
    hasAction,
    summary: summaryParts.length ? summaryParts.join(' · ') : 'No panel action detected.',
  };
}
