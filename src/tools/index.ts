/**
 * Tool Registry - registers all Dockhand MCP tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerContainerTools } from './containers.js';
import { registerStackTools } from './stacks.js';
import { registerImageTools } from './images.js';
import { registerEnvironmentTools } from './environments.js';
import { registerNetworkTools } from './networks.js';
import { registerVolumeTools } from './volumes.js';
import { registerGitStackTools } from './git-stacks.js';
import { registerDashboardTools } from './dashboard.js';
import { registerAuthTools } from './auth.js';
import { registerAuditTools } from './audit.js';
import { registerNotificationTools } from './notifications.js';
import { registerRegistryTools } from './registries.js';
import { registerSystemTools } from './system.js';
import { registerUserTools } from './users.js';
import { registerScheduleTools } from './schedules.js';
import { registerAutoUpdateTools } from './auto-update.js';

export function registerAllTools(server: McpServer, client: DockhandClient): void {
  registerContainerTools(server, client);
  registerStackTools(server, client);
  registerImageTools(server, client);
  registerEnvironmentTools(server, client);
  registerNetworkTools(server, client);
  registerVolumeTools(server, client);
  registerGitStackTools(server, client);
  registerDashboardTools(server, client);
  registerAuthTools(server, client);
  registerAuditTools(server, client);
  registerNotificationTools(server, client);
  registerRegistryTools(server, client);
  registerSystemTools(server, client);
  registerUserTools(server, client);
  registerScheduleTools(server, client);
  registerAutoUpdateTools(server, client);

  console.error('[tools] All Dockhand tools registered');
}
