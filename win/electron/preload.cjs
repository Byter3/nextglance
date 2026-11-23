const { contextBridge, ipcRenderer } = require('electron')

// No Node primitives, generic IPC, filesystem paths, or credentials are exposed.
const methods = ['getState', 'retryConnection', 'refresh', 'saveWorkspace', 'beginLogin', 'pollLogin', 'cancelLogin', 'connect', 'disconnect', 'createNote', 'updateNote', 'updateDescription', 'updateRecordDates', 'updateRecordAppearance', 'updateTaskStatus', 'createTask', 'createCard', 'setTaskCompleted', 'setTaskDue', 'createEvent', 'createLinkedEvent', 'updateEvent', 'setCardCompleted', 'moveCard', 'setDeckDependency', 'readPage', 'readPageAsset', 'syncWorkspace', 'exportWorkspace', 'openExternal']
methods.push('readNote', 'readNoteTags', 'setNoteTags', 'createDeckLabel', 'listFiles', 'readDeckAttachments', 'attachDeckFile', 'removeDeckAttachment', 'uploadDeckAttachment', 'readRelatedResources', 'migrateDeckNoteLinks')
methods.push('deleteEvent', 'deleteTask')
methods.push('respondToEvent')
methods.push('getViewPreferences', 'saveViewPreferences')
methods.push('setCalendarHistoryDays')
const api = Object.fromEntries(methods.map(method => [method, (...args) => ipcRenderer.invoke(`nextspace:${method}`, ...args)]))
contextBridge.exposeInMainWorld('workspaceApi', Object.freeze(api))
