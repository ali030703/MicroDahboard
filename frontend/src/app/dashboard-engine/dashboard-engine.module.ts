// Purpose: Declares and exports reusable dashboard engine components and Chart.js integration.
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import { TemplateRendererComponent } from './components/template-renderer/template-renderer.component';
import { ChartWidgetComponent } from './components/chart-widget/chart-widget.component';
import { StatsWidgetComponent } from './components/stats-widget/stats-widget.component';

@NgModule({
  declarations: [
    TemplateRendererComponent,
    ChartWidgetComponent,
    StatsWidgetComponent,
  ],
  imports: [CommonModule, BaseChartDirective],
  exports: [
    TemplateRendererComponent,
    ChartWidgetComponent,
    StatsWidgetComponent,
    BaseChartDirective,
  ],
})
export class DashboardEngineModule {}
