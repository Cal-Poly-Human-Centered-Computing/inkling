// Shared sizes for the column summaries on the dataset preview page, so their charts and stats line up across columns.

import { TOP_K } from '$lib/utils/datasetSummary';

/** Width of every summary chart, in px. */
export const CHART_WIDTH = 160;

/** Height of one bar's slot in a categorical chart, in px. */
export const BAR_SLOT = 14;

/** Height of the "(N more)" line under a categorical chart, in px. */
const MORE_LINE = 16;

/** Height of every summary chart's box, in px: room for TOP_K categorical bars and the "(N more)" line. */
export const CHART_HEIGHT = TOP_K * BAR_SLOT + MORE_LINE;
