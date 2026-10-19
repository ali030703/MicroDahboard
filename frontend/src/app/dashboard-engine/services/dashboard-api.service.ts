// Purpose: Calls backend dashboard and session APIs from the Angular frontend.
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DashboardDatasets,
  DashboardGenerationResponse,
  DashboardSessionSnapshot,
  DashboardTemplate,
} from '../models/dashboard.model';
import { BuildGenerationPayloadResult } from '../utils/dashboard-workflow';

export interface DashboardRenderPayload {
  dashboardDefinition: DashboardTemplate;
  datasets: DashboardDatasets;
  metadata?: {
    source?: 'chatbot' | 'backend' | 'manual' | string;
    prompt?: string;
    semanticCatalog?: unknown;
    warnings?: string[];
  };
  sessionId?: string;
}

export interface DashboardSemanticCatalogRequest {
  databasePath?: string;
  databaseDefinition?: unknown;
}

export interface DashboardSemanticCatalogResponse {
  semanticCatalog: unknown;
  schema: unknown[];
  promptHelp: unknown;
  contract: {
    renderEndpoint: string;
    requiredPayload: string[];
    optionalPayload: string[];
    lowConfidenceThreshold: number;
    supportedChartTemplates: string[];
    supportedTransforms: string[];
  };
  metadata: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class DashboardApiService {
  constructor(private readonly http: HttpClient) {}

  startSession(apiBaseUrl: string, sessionId?: string): Observable<DashboardSessionSnapshot> {
    return this.http.post<DashboardSessionSnapshot>(`${apiBaseUrl}/dashboard/session/start`, {
      sessionId: sessionId || undefined,
    });
  }

  resetSession(apiBaseUrl: string, sessionId: string): Observable<DashboardSessionSnapshot> {
    return this.http.post<DashboardSessionSnapshot>(`${apiBaseUrl}/dashboard/session/reset`, {
      sessionId,
    });
  }

  generateDashboard(apiBaseUrl: string, payload: BuildGenerationPayloadResult): Observable<DashboardGenerationResponse> {
    return this.http.post<DashboardGenerationResponse>(`${apiBaseUrl}/dashboard/generate`, payload);
  }

  renderDashboard(apiBaseUrl: string, payload: DashboardRenderPayload): Observable<DashboardGenerationResponse> {
    return this.http.post<DashboardGenerationResponse>(`${apiBaseUrl}/dashboard/render`, payload);
  }

  loadSemanticCatalog(apiBaseUrl: string, payload?: DashboardSemanticCatalogRequest): Observable<DashboardSemanticCatalogResponse> {
    if (payload?.databasePath || payload?.databaseDefinition) {
      return this.http.post<DashboardSemanticCatalogResponse>(`${apiBaseUrl}/dashboard/semantic-catalog`, payload);
    }

    return this.http.get<DashboardSemanticCatalogResponse>(`${apiBaseUrl}/dashboard/semantic-catalog`);
  }

  loadCategories(apiBaseUrl: string): Observable<{ category_id: number; category_name: string }[]> {
    return this.http.get<{ category_id: number; category_name: string }[]>(`${apiBaseUrl}/categories`);
  }
}
