// Purpose: Chooses the correct widget renderer for each dashboard component definition.
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { 
  ChartPointSelection, 
  ChartWidgetModel, 
  DashboardModel, 
  StatsWidgetModel, 
  TableWidgetModel 
} from '../../models/dashboard.model';

type DashboardComponent = ChartWidgetModel | StatsWidgetModel | TableWidgetModel;

@Component({
  selector: 'app-template-renderer',
  standalone: false,
  templateUrl: './template-renderer.component.html',
  styleUrls: ['./template-renderer.component.css'],
})
export class TemplateRendererComponent {
  @Input({ required: true }) dashboard!: DashboardModel;
  @Input() showChartsOnly = false;
  @Input() selectedComponentId: string | null = null;
  @Input() focusedComponentId: string | null = null;
  
  @Output() chartDataPointSelected = new EventEmitter<ChartPointSelection>();
  @Output() componentSelected = new EventEmitter<string>();

  /**
   * Safely merges the blueprint with actual data rows.
   * Using 'any' as return type here prevents template compilation errors 
   * when accessing .data or .columns on union types.
   */
  getComponentWithData(component: DashboardComponent): any {
    if (component.type === 'table') {
      return {
        ...component,
        data: Array.isArray((component as any).rows) ? (component as any).rows : [],
      };
    }

    return component as any;
  }

  isChartComponent(component: DashboardComponent): component is ChartWidgetModel {
    return component.type === 'chart';
  }

  isStatsComponent(component: DashboardComponent): component is StatsWidgetModel {
    return component.type === 'stats';
  }

  isTableComponent(component: DashboardComponent): component is TableWidgetModel {
    return component.type === 'table';
  }

  shouldRenderComponent(component: DashboardComponent): boolean {
    if (this.focusedComponentId && component.id !== this.focusedComponentId) {
      return false;
    }
    if (this.showChartsOnly) {
      return this.isChartComponent(component);
    }
    return true;
  }

  onChartPointSelected(selection: ChartPointSelection) {
    this.chartDataPointSelected.emit(selection);
  }

  onComponentClicked(componentId: string) {
    this.componentSelected.emit(componentId);
  }
}
