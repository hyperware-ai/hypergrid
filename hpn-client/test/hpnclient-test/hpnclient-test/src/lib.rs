use crate::hyperware::process::hpnclient::{HpnclientMessage, Request as HpnclientRequest, Response as HpnclientResponse, SendRequest};
use crate::hyperware::process::tester::{Request as TesterRequest, Response as TesterResponse, RunRequest, FailResponse};

use hyperware_process_lib::{await_message, call_init, print_to_terminal, Address, ProcessId, Request, Response};

mod tester_lib;

wit_bindgen::generate!({
    path: "target/wit",
    world: "hpnclient-test-sortugdev-dot-os-v0",
    generate_unused_types: true,
    additional_derives: [PartialEq, serde::Deserialize, serde::Serialize, process_macros::SerdeJsonInto],
});

fn handle_message (our: &Address) -> anyhow::Result<()> {
    let message = await_message().unwrap();

    if !message.is_request() {
        unimplemented!();
    }
    let source = message.source();
    if our.node != source.node {
        return Err(anyhow::anyhow!(
            "rejecting foreign Message from {:?}",
            source,
        ));
    }
    let TesterRequest::Run(RunRequest {
        input_node_names: node_names,
        ..
    }) = message.body().try_into()?;
    print_to_terminal(0, "hpnclient_test: a");
    assert!(node_names.len() >= 2);
    if our.node != node_names[0] {
        // we are not master node: return
        Response::new()
            .body(TesterResponse::Run(Ok(())))
            .send()
            .unwrap();
        return Ok(());
    }

    // we are master node

    let our_hpnclient_address = Address {
        node: our.node.clone(),
        process: ProcessId::new(Some("hpnclient"), "hpnclient", "sortugdev.os"),
    };
    let their_hpnclient_address = Address {
        node: node_names[1].clone(),
        process: ProcessId::new(Some("hpnclient"), "hpnclient", "sortugdev.os"),
    };

    // Send
    print_to_terminal(0, "hpnclient_test: b");
    let message: String = "hello".into();
    let _ = Request::new()
        .target(our_hpnclient_address.clone())
        .body(HpnclientRequest::Send(SendRequest {
            target: node_names[1].clone(),
            message: message.clone(),
        }))
        .send_and_await_response(15)?.unwrap();

    // Get history from receiver & test
    print_to_terminal(0, "hpnclient_test: c");
    let response = Request::new()
        .target(their_hpnclient_address.clone())
        .body(HpnclientRequest::History(our.node.clone()))
        .send_and_await_response(15)?.unwrap();
    if response.is_request() { fail!("hpnclient_test"); };
    let HpnclientResponse::History(messages) = response.body().try_into()? else {
        fail!("hpnclient_test");
    };
    let expected_messages = vec![HpnclientMessage {
        author: our.node.clone(),
        content: message,
    }];

    if messages != expected_messages {
        info!("{messages:?} != {expected_messages:?}");
        fail!("hpnclient_test");
    }

    Response::new()
        .body(TesterResponse::Run(Ok(())))
        .send()
        .unwrap();

    Ok(())
}

call_init!(init);
fn init(our: Address) {
    print_to_terminal(0, "begin");

    loop {
        match handle_message(&our) {
            Ok(()) => {},
            Err(e) => {
                print_to_terminal(0, format!("hpnclient_test: error: {e:?}").as_str());

                fail!("hpnclient_test");
            },
        };
    }
}
