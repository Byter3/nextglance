import type {PlannerView,WorkspaceRecord} from '@nextspace/contracts'
export function linkedNavigation(input:{recordId:string;records:WorkspaceRecord[];visibleIds:string[];currentView:PlannerView;destination?:'calendar'|'timeline'}):{ok:false;message:string}|{ok:true;view:'overview'|'calendar'|'timeline';date?:string;unscheduled:boolean}
