export type DashboardFilterMode = "day" | "range" | "month";

export function dashboardFilterKey(
  activeMode: DashboardFilterMode,
  activeStartDate: string,
  activeEndDate: string,
): string {
  return `${activeMode}|${activeStartDate}|${activeEndDate}`;
}

export function normalizeDashboardRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
  return endDate < startDate ? { startDate: endDate, endDate: startDate } : { startDate, endDate };
}
