/**
 * TypeScript interfaces for the Dockhand REST API.
 */

export interface DockhandConfig {
  url: string;
  username: string;
  password: string;
}

export interface SessionInfo {
  cookie: string;
  expiresAt: number;
}

export interface Environment {
  id: number;
  name: string;
  connectionType: string;
  status?: string;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports?: PortBinding[];
  labels?: Record<string, string>;
}

export interface PortBinding {
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface Stack {
  name: string;
  status: string;
  containerCount: number;
  type?: string;
}

export interface StackCompose {
  content: string;
  path?: string;
}

export interface StackEnv {
  variables: EnvVariable[];
  rawContent?: string;
}

export interface EnvVariable {
  key: string;
  value: string;
  isSecret?: boolean;
}

export interface DockerImage {
  id: string;
  repoTags: string[];
  size: number;
  created: string;
}

export interface Network {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface Volume {
  name: string;
  driver: string;
  mountpoint: string;
}

export interface GitStack {
  id: number;
  name: string;
  repositoryUrl: string;
  branch: string;
  status?: string;
}

export interface DashboardStats {
  containers: { running: number; stopped: number; total: number };
  images: { total: number; size: number };
  volumes: { total: number };
  networks: { total: number };
}

export interface AuditLogEntry {
  id: number;
  action: string;
  user: string;
  timestamp: string;
  details?: string;
}

export interface Notification {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
}

export interface Registry {
  id: number;
  name: string;
  url: string;
  type: string;
}

export interface HawserToken {
  id: number;
  name: string;
  environmentId: number;
  token?: string;
  expiresAt?: string;
}

export interface User {
  id: number;
  username: string;
  email?: string;
  roles?: string[];
}

export interface Role {
  id: number;
  name: string;
  permissions?: string[];
}

export interface Schedule {
  id: number;
  type: string;
  name: string;
  enabled: boolean;
}

export interface ConfigSet {
  id: number;
  name: string;
}

export interface SSEEvent {
  event?: string;
  data: string;
}

export interface SSEResult {
  success: boolean;
  output?: string;
  error?: string;
  jobId?: string;
}

export interface AutoUpdateSettings {
  policy: 'never' | 'any' | 'critical-high' | 'critical' | 'more-than-current';
}

export interface ScannerSettings {
  scanner: string;
  enabled: boolean;
}

export interface PruneResult {
  spaceReclaimed: number;
  itemsDeleted: number;
}
