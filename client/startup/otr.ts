import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';

import { Notifications } from '../../app/notifications/client';
import { OTR } from '../../app/otr/client/rocketchat.otr';
import { t } from '../../app/utils/client';
import { IMessage } from '../../definition/IMessage';
import { onClientBeforeSendMessage } from '../lib/onClientBeforeSendMessage';
import { onClientMessageReceived } from '../lib/onClientMessageReceived';

type NotifyUserData = {
	roomId?: string;
	userId?: string;
};

Meteor.startup(() => {
	Tracker.autorun(() => {
		if (Meteor.userId()) {
			Notifications.onUser('otr', (type: string, data: NotifyUserData) => {
				if (!data.roomId || !data.userId || data.userId === Meteor.userId()) {
					return;
				}
				OTR.getInstanceByRoomId(data.roomId).onUserStream(type, data);
			});
		}
	});

	onClientBeforeSendMessage.use(async (message: IMessage) => {
		if (message.rid && OTR.getInstanceByRoomId(message.rid) && OTR.getInstanceByRoomId(message.rid).established.get()) {
			const msg = await OTR.getInstanceByRoomId(message.rid).encrypt(message);
			return { ...message, msg, t: 'otr' };
		}
		return message;
	});

	onClientMessageReceived.use(async (message) => {
		if (message.rid && OTR.getInstanceByRoomId(message.rid) && OTR.getInstanceByRoomId(message.rid).established.get()) {
			if (message.notification) {
				message.msg = t('Encrypted_message');
				return message;
			}
			const otrRoom = OTR.getInstanceByRoomId(message.rid);
			const { _id, text: msg, ack, ts, userId } = await otrRoom.decrypt(message.msg);

			if (ts) message.ts = ts;

			if (message.otrAck) {
				const { text: otrAckText } = await otrRoom.decrypt(message.otrAck);
				if (ack === otrAckText) message.t = 'otr-ack';
			} else if (userId !== Meteor.userId()) {
				const encryptedAck = await otrRoom.encryptText(ack);

				Meteor.call('updateOTRAck', { message, ack: encryptedAck });
			}

			return { ...message, _id, msg };
		}
		if (message.t === 'otr') message.msg = '';

		return message;
	});
});