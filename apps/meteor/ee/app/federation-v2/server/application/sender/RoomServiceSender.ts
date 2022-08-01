import { FederationService } from '../../../../../../app/federation-v2/server/application/AbstractFederationService';
import { RocketChatSettingsAdapter } from '../../../../../../app/federation-v2/server/infrastructure/rocket-chat/adapters/Settings';
import { IFederationBridgeEE } from '../../domain/IFederationBridge';
import { RocketChatNotificationAdapter } from '../../infrastructure/rocket-chat/adapters/Notification';
import { RocketChatRoomAdapterEE } from '../../infrastructure/rocket-chat/adapters/Room';
import { RocketChatUserAdapterEE } from '../../infrastructure/rocket-chat/adapters/User';
import { FederationCreateDirectMessageDto } from '../input/RoomSenderDto';

export class FederationRoomServiceSenderEE extends FederationService {
	constructor(
		protected rocketRoomAdapter: RocketChatRoomAdapterEE,
		protected rocketUserAdapter: RocketChatUserAdapterEE,
		protected rocketSettingsAdapter: RocketChatSettingsAdapter,
		protected rocketNotificationAdapter: RocketChatNotificationAdapter,
		protected bridge: IFederationBridgeEE,
	) {
		super(bridge, rocketUserAdapter, rocketSettingsAdapter);
	}

	public async createLocalDirectMessageRoom(dmRoomCreateInput: FederationCreateDirectMessageDto): Promise<void> {
		const { internalInviterId, invitees } = dmRoomCreateInput;

		await this.rocketRoomAdapter.createLocalDirectMessageRoom(invitees, internalInviterId);
	}
}
