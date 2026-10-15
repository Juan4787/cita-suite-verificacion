export type SendTemplateInput = {
	businessId: string;
	messagingAccountId: string;
	to: string;
	templateName: string;
	language: string;
	variables: string[];
};

export type SendFreeFormInput = {
	businessId: string;
	messagingAccountId: string;
	to: string;
	text: string;
};

export type SendTemplateResult = {
	providerMessageId: string;
	raw: unknown;
};

export interface MessagingProvider {
	sendTemplate(input: SendTemplateInput): Promise<SendTemplateResult>;
	sendFreeForm(input: SendFreeFormInput): Promise<SendTemplateResult>;
}
