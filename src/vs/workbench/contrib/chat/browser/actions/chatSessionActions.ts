/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { Action2, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IChatService } from '../../common/chatService.js';
import { IChatSessionsService } from '../../common/chatSessionsService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import Severity from '../../../../../base/common/severity.js';
import { ChatContextKeys } from '../../common/chatContextKeys.js';
import { IEditorService, ACTIVE_GROUP, AUX_WINDOW_GROUP } from '../../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IChatWidgetService, ChatViewId } from '../chat.js';
import { ChatEditor, IChatEditorOptions } from '../chatEditor.js';
import { ChatEditorInput } from '../chatEditorInput.js';
import { ChatViewPane } from '../chatViewPane.js';

export interface IChatSessionContext {
	sessionId: string;
	sessionType: 'editor' | 'widget';
	currentTitle: string;
	editorInput?: any;
	editorGroup?: any;
	widget?: any;
}

interface IMarshalledChatSessionContext {
	session: IChatSessionItem;
	$mid: number; // MarshalledId.ChatSessionContext
}

// Type guard to check if context is marshalled
function isMarshalledContext(context: any): context is IMarshalledChatSessionContext {
	return context && typeof context === 'object' && '$mid' in context && 'session' in context;
}

// Helper function to extract session information from either context format
function extractSessionInfo(context: any): { sessionId: string; sessionType: 'editor' | 'widget'; editorInput?: any; editorGroup?: any; widget?: any } | null {
	if (isMarshalledContext(context)) {
		const session = context.session as any;
		if ('sessionType' in session) {
			return {
				sessionId: session.sessionType === 'editor' && session.editor?.sessionId 
					? session.editor.sessionId
					: session.widget?.viewModel?.model.sessionId,
				sessionType: session.sessionType,
				editorInput: session.editor,
				editorGroup: session.group,
				widget: session.widget
			};
		}
	} else if (context && typeof context === 'object' && 'sessionId' in context) {
		// Legacy IChatSessionContext format
		return {
			sessionId: context.sessionId,
			sessionType: context.sessionType,
			editorInput: context.editorInput,
			editorGroup: context.editorGroup,
			widget: context.widget
		};
	}
	return null;
}

export class RenameChatSessionAction extends Action2 {
	static readonly id = 'workbench.action.chat.renameSession';

	constructor() {
		super({
			id: RenameChatSessionAction.id,
			title: localize('renameSession', "Rename"),
			f1: false,
			category: 'Chat',
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyCode.F2,
				when: ContextKeyExpr.equals('focusedView', 'workbench.view.chat.sessions.local')
			}
		});
	}

	async run(accessor: ServicesAccessor, context?: IChatSessionContext): Promise<void> {
		if (!context) {
			return;
		}

		const chatSessionsService = accessor.get(IChatSessionsService);
		const logService = accessor.get(ILogService);
		const chatService = accessor.get(IChatService);

		try {
			// Find the chat sessions view and trigger inline rename mode
			// This is similar to how file renaming works in the explorer
			await chatSessionsService.setEditableSession(context.sessionId, {
				validationMessage: (value: string) => {
					if (!value || value.trim().length === 0) {
						return { content: localize('renameSession.emptyName', "Name cannot be empty"), severity: Severity.Error };
					}
					if (value.length > 100) {
						return { content: localize('renameSession.nameTooLong', "Name is too long (maximum 100 characters)"), severity: Severity.Error };
					}
					return null;
				},
				placeholder: localize('renameSession.placeholder', "Enter new name for chat session"),
				startingValue: context.currentTitle,
				onFinish: async (value: string, success: boolean) => {
					if (success && value && value.trim() !== context.currentTitle) {
						try {
							const newTitle = value.trim();
							chatService.setChatSessionTitle(context.sessionId, newTitle);
						} catch (error) {
							logService.error(
								localize('renameSession.error', "Failed to rename chat session: {0}",
									(error instanceof Error ? error.message : String(error)))
							);
						}
					}
					await chatSessionsService.setEditableSession(context.sessionId, null);
				}
			});
		} catch (error) {
			logService.error('Failed to rename chat session', error instanceof Error ? error.message : String(error));
		}
	}
}

export class MoveChatSessionToNewEditorAction extends Action2 {
	static readonly id = 'workbench.action.chat.moveSessionToNewEditor';

	constructor() {
		super({
			id: MoveChatSessionToNewEditorAction.id,
			title: localize('moveSessionToNewEditor', "Move to New Editor to the Side"),
			f1: false,
			category: 'Chat'
		});
	}

	async run(accessor: ServicesAccessor, context?: any): Promise<void> {
		const sessionInfo = extractSessionInfo(context);
		if (!sessionInfo) {
			return;
		}

		const editorService = accessor.get(IEditorService);

		if (sessionInfo.sessionType === 'editor' && sessionInfo.editorInput && sessionInfo.editorGroup) {
			// For editor sessions, close the original
			const chatEditor = sessionInfo.editorInput;
			if (chatEditor instanceof ChatEditorInput) {
				await editorService.closeEditor({ editor: chatEditor, groupId: sessionInfo.editorGroup.id });
			}
		} else if (sessionInfo.sessionType === 'widget' && sessionInfo.widget) {
			// For widget sessions, clear the widget
			const widget = sessionInfo.widget;
			widget.clear();
			await widget.waitForReady();
		}

		// Open in new editor to the side - the target will handle loading the session
		const options: IChatEditorOptions = { 
			target: { sessionId: sessionInfo.sessionId }, 
			pinned: true
		};
		await editorService.openEditor({ resource: ChatEditorInput.getNewEditorUri(), options }, ACTIVE_GROUP);
	}
}

export class MoveChatSessionToNewWindowAction extends Action2 {
	static readonly id = 'workbench.action.chat.moveSessionToNewWindow';

	constructor() {
		super({
			id: MoveChatSessionToNewWindowAction.id,
			title: localize('moveSessionToNewWindow', "Move to New Window"),
			f1: false,
			category: 'Chat'
		});
	}

	async run(accessor: ServicesAccessor, context?: any): Promise<void> {
		const sessionInfo = extractSessionInfo(context);
		if (!sessionInfo) {
			return;
		}

		const editorService = accessor.get(IEditorService);

		if (sessionInfo.sessionType === 'editor' && sessionInfo.editorInput && sessionInfo.editorGroup) {
			// For editor sessions, close the original
			const chatEditor = sessionInfo.editorInput;
			if (chatEditor instanceof ChatEditorInput) {
				await editorService.closeEditor({ editor: chatEditor, groupId: sessionInfo.editorGroup.id });
			}
		} else if (sessionInfo.sessionType === 'widget' && sessionInfo.widget) {
			// For widget sessions, clear the widget
			const widget = sessionInfo.widget;
			widget.clear();
			await widget.waitForReady();
		}

		// Open in new auxiliary window - the target will handle loading the session
		const options: IChatEditorOptions = { 
			target: { sessionId: sessionInfo.sessionId }, 
			pinned: true,
			auxiliary: { compact: true, bounds: { width: 640, height: 640 } }
		};
		await editorService.openEditor({ resource: ChatEditorInput.getNewEditorUri(), options }, AUX_WINDOW_GROUP);
	}
}

export class MoveChatSessionToSideBarAction extends Action2 {
	static readonly id = 'workbench.action.chat.moveSessionToSideBar';

	constructor() {
		super({
			id: MoveChatSessionToSideBarAction.id,
			title: localize('moveSessionToSideBar', "Move to Side Bar"),
			f1: false,
			category: 'Chat'
		});
	}

	async run(accessor: ServicesAccessor, context?: any): Promise<void> {
		const sessionInfo = extractSessionInfo(context);
		if (!sessionInfo) {
			return;
		}

		const editorService = accessor.get(IEditorService);
		const viewsService = accessor.get(IViewsService);

		if (sessionInfo.sessionType === 'editor' && sessionInfo.editorInput && sessionInfo.editorGroup) {
			// For editor sessions, close the original and open in side bar
			const chatEditor = sessionInfo.editorInput;
			if (chatEditor instanceof ChatEditorInput) {
				await editorService.closeEditor({ editor: chatEditor, groupId: sessionInfo.editorGroup.id });
				
				// Open in side bar and load the session
				const view = await viewsService.openView(ChatViewId) as ChatViewPane;
				await view.loadSession(sessionInfo.sessionId);
				view.focus();
			}
		} else if (sessionInfo.sessionType === 'widget') {
			// Widget is already in the side bar, so just focus it
			const view = await viewsService.openView(ChatViewId) as ChatViewPane;
			view.focus();
		}
	}
}

// Register the menu item - only show for local chat sessions
MenuRegistry.appendMenuItem(MenuId.ChatSessionsMenu, {
	command: {
		id: RenameChatSessionAction.id,
		title: localize('renameSession', "Rename")
	},
	group: 'context',
	order: 1,
	when: ChatContextKeys.sessionType.isEqualTo('local')
});

// Register migration action menu items - only show for non-local chat sessions
MenuRegistry.appendMenuItem(MenuId.ChatSessionsMenu, {
	command: {
		id: MoveChatSessionToNewEditorAction.id,
		title: localize('moveSessionToNewEditor', "Move to New Editor to the Side")
	},
	group: 'migration',
	order: 1,
	when: ChatContextKeys.sessionType.notEqualsTo('local')
});

MenuRegistry.appendMenuItem(MenuId.ChatSessionsMenu, {
	command: {
		id: MoveChatSessionToNewWindowAction.id,
		title: localize('moveSessionToNewWindow', "Move to New Window")
	},
	group: 'migration',
	order: 2,
	when: ChatContextKeys.sessionType.notEqualsTo('local')
});

MenuRegistry.appendMenuItem(MenuId.ChatSessionsMenu, {
	command: {
		id: MoveChatSessionToSideBarAction.id,
		title: localize('moveSessionToSideBar', "Move to Side Bar")
	},
	group: 'migration',
	order: 3,
	when: ChatContextKeys.sessionType.notEqualsTo('local')
});
