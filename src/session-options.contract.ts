import type { SessionOptions } from './main';

type RendererSessionOptions = Parameters<CodexAPI['startSession']>[0];
type RemoteLlamaCppOptions = {
  remoteLlamaCpp?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
};

type AssertAssignable<Actual extends Expected, Expected> = true;

type RendererSendsRemoteLlamaCpp = AssertAssignable<RendererSessionOptions, RemoteLlamaCppOptions>;
type MainAcceptsRendererSessionOptions = AssertAssignable<RendererSessionOptions, SessionOptions>;
type RendererCoversMainRemoteOptions = AssertAssignable<SessionOptions, RendererSessionOptions>;

export type SessionOptionsContractChecks =
  | RendererSendsRemoteLlamaCpp
  | MainAcceptsRendererSessionOptions
  | RendererCoversMainRemoteOptions;
