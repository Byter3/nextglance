/// <reference types="vite/client" />
import type {WorkspaceApi} from '@nextspace/contracts'
declare global {interface Window {workspaceApi?:WorkspaceApi}}
