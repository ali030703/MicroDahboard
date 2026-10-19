// Purpose: Displays dashboard data points as a reusable stats widget component.
// === FILE DESCRIPTION ===
// Displays KPI cards.
// Used for compact data summaries.
import { Component, Input } from '@angular/core';
import { DashboardDataPoint } from '../../models/dashboard.model';

@Component({
  selector: 'app-stats-widget',
  standalone: false,
  templateUrl: './stats-widget.component.html',
  styleUrls: ['./stats-widget.component.css'],
})
export class StatsWidgetComponent {
  @Input({ required: true }) cards: DashboardDataPoint[] = [];
}
