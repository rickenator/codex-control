//! Security model for credential access and approval policies.
//! 
//! Credentials remain in existing Codex configuration or the desktop keyring.
//! Every elevated or destructive action requires explicit approval unless
//! the user has configured a matching allow rule.

pub struct ApprovalPolicy {
    pub require_approval: bool,
    pub allow_rules: Vec<AllowRule>,
}

#[derive(Clone)]
pub struct AllowRule {
    pub command_pattern: String,
    pub working_dir_pattern: Option<String>,
}
