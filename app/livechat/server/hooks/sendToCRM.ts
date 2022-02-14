import { SettingValue } from '../../../../definition/ISetting';
import { settings } from '../../../settings/server';
import { callbacks } from '../../../../lib/callbacks';
import { Messages, LivechatRooms } from '../../../models/server/index';
import { Livechat } from '../lib/Livechat';
import { normalizeMessageFileUpload } from '../../../utils/server/functions/normalizeMessageFileUpload';

const msgNavType = 'livechat_navigation_history';
const msgClosingType = 'livechat-close';

type RoomData = {
	_id: string;
	departmentId: string;
	servedBy: Date;
	closedAt: Date;
	closedBy: Date;
	closer: string;
	oldServedBy: Date;
	oldDepartmentId: string;
};

type PostData = {
	_id: string;
	label: string;
	type: string;
	topic: string;
	createdAt: Date;
	lastMessageAt: Date;
	tags: string[];
	customFields: any[];
	messages: any[];
	visitor: {
		_id: string;
		token: string;
		name: string;
		username: string;
		email: string;
		phone: string;
		department: string;
		ip: string;
		os: string | undefined;
		browser: string | undefined;
		customFields: any[];
	};
};

const sendMessageType = (msgType: string): boolean | SettingValue => {
	switch (msgType) {
		case msgClosingType:
			return true;
		case msgNavType:
			return (
				settings.get('Livechat_Visitor_navigation_as_a_message') && settings.get('Send_visitor_navigation_history_livechat_webhook_request')
			);
		default:
			return false;
	}
};

const getAdditionalFieldsByType = (
	type: string,
	room: RoomData,
): {
	departmentId?: string;
	servedBy?: Date;
	closedAt?: Date;
	closedBy?: Date;
	closer?: string;
	oldDepartmentId?: string;
	oldServedBy?: Date;
} => {
	const { departmentId, servedBy, closedAt, closedBy, closer, oldServedBy, oldDepartmentId } = room;
	switch (type) {
		case 'LivechatSessionStarted':
		case 'LivechatSessionQueued':
			return { departmentId };
		case 'LivechatSession':
			return { departmentId, servedBy, closedAt, closedBy, closer };
		case 'LivechatSessionTaken':
			return { departmentId, servedBy };
		case 'LivechatSessionForwarded':
			return { departmentId, servedBy, oldDepartmentId, oldServedBy };
		default:
			return {};
	}
};
function sendToCRM(type: string, room: RoomData, includeMessages: boolean): RoomData {
	includeMessages = true;

	if (!settings.get('Livechat_webhookUrl')) {
		return room;
	}

	const postData: PostData = Livechat.getLivechatRoomGuestInfo(room);

	postData.type = type;

	postData.messages = [];

	let messages;
	if (typeof includeMessages === 'boolean' && includeMessages) {
		messages = Messages.findVisibleByRoomId(room._id, { sort: { ts: 1 } });
	} else if (includeMessages instanceof Array) {
		messages = includeMessages;
	}

	if (messages) {
		messages.forEach((message) => {
			if (message.t && !sendMessageType(message.t)) {
				return;
			}
			const msg = {
				_id: message._id,
				username: message.u.username,
				msg: message.msg,
				ts: message.ts,
				editedAt: message.editedAt,
				agentId: undefined,
				navigation: undefined,
				closingMessage: false,
				file: undefined,
				attachments: null,
			};

			if (message.u.username !== postData.visitor.username) {
				msg.agentId = message.u._id;
			}

			if (message.t === msgNavType) {
				msg.navigation = message.navigation;
			}

			if (message.t === msgClosingType) {
				msg.closingMessage = true;
			}

			if (message.file) {
				msg.file = message.file;
				msg.attachments = message.attachments;
			}

			const { u } = message;
			postData.messages.push(Promise.await(normalizeMessageFileUpload({ u, ...msg })));
		});
	}

	const additionalData = getAdditionalFieldsByType(type, room);
	const responseData = Object.assign(postData, additionalData);

	const response = Livechat.sendRequest(responseData);

	if (response?.data?.data) {
		LivechatRooms.saveCRMDataByRoomId(room._id, response.data.data);
	}

	return room;
}

callbacks.add(
	'livechat.closeRoom',
	(room) => {
		if (!settings.get('Livechat_webhook_on_close')) {
			return room;
		}

		return sendToCRM('LivechatSession', room);
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-close-room',
);

callbacks.add(
	'livechat.newRoom',
	(room) => {
		if (!settings.get('Livechat_webhook_on_start')) {
			return room;
		}

		return sendToCRM('LivechatSessionStart', room);
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-start-room',
);

callbacks.add(
	'livechat.afterTakeInquiry',
	(inquiry) => {
		if (!settings.get('Livechat_webhook_on_chat_taken')) {
			return inquiry;
		}

		const { rid } = inquiry;
		const room = LivechatRooms.findOneById(rid);

		return sendToCRM('LivechatSessionTaken', room);
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-room-taken',
);

callbacks.add(
	'livechat.chatQueued',
	(room) => {
		if (!settings.get('Livechat_webhook_on_chat_queued')) {
			return room;
		}

		return sendToCRM('LivechatSessionQueued', room);
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-room-queued',
);

callbacks.add(
	'livechat.afterForwardChatToAgent',
	(params) => {
		const { rid, oldServedBy } = params;
		if (!settings.get('Livechat_webhook_on_forward')) {
			return params;
		}

		const originalRoom = LivechatRooms.findOneById(rid);
		const room = Object.assign(originalRoom, { oldServedBy });
		sendToCRM('LivechatSessionForwarded', room);
		return params;
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-room-forwarded-to-agent',
);

callbacks.add(
	'livechat.afterForwardChatToDepartment',
	(params) => {
		const { rid, oldDepartmentId } = params;
		if (!settings.get('Livechat_webhook_on_forward')) {
			return params;
		}

		const originalRoom = LivechatRooms.findOneById(rid);
		const room = Object.assign(originalRoom, { oldDepartmentId });
		sendToCRM('LivechatSessionForwarded', room);
		return params;
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-room-forwarded-to-department',
);

callbacks.add(
	'livechat.saveInfo',
	(room) => {
		// Do not send to CRM if the chat is still open
		if (room.open) {
			return room;
		}

		return sendToCRM('LivechatEdit', room);
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-save-info',
);

callbacks.add(
	'afterSaveMessage',
	function (message, room) {
		// only call webhook if it is a livechat room
		if (room.t !== 'l' || room.v == null || room.v.token == null) {
			return message;
		}

		// if the message has a token, it was sent from the visitor
		// if not, it was sent from the agent
		if (message.token) {
			if (!settings.get('Livechat_webhook_on_visitor_message')) {
				return message;
			}
		} else if (!settings.get('Livechat_webhook_on_agent_message')) {
			return message;
		}
		// if the message has a type means it is a special message (like the closing comment), so skips
		// unless the settings that handle with visitor navigation history are enabled
		if (message.t && !sendMessageType(message.t)) {
			return message;
		}

		sendToCRM('Message', room, [message]);
		return message;
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-message',
);

callbacks.add(
	'livechat.leadCapture',
	(room) => {
		if (!settings.get('Livechat_webhook_on_capture')) {
			return room;
		}
		return sendToCRM('LeadCapture', room, false);
	},
	callbacks.priority.MEDIUM,
	'livechat-send-crm-lead-capture',
);
