// Purpose: Provides root Angular application configuration, including HTTP support.
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { DashboardApiService } from './dashboard-engine/services/dashboard-api.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    DashboardApiService,
  ],
};
