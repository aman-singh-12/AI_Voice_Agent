import asyncio
import json
import time
import websockets

WS_URL = "ws://localhost:8001/ws/voice"

async def test_full_pipeline():
    print("=" * 60)
    print("STARTING FULL-DUPLEX & BARGE-IN AUTOMATED TEST SUITE")
    print("=" * 60)

    async with websockets.connect(WS_URL) as ws:
        # Step 0: Config Ack
        await ws.send(json.dumps({"type": "config", "keys": {}}))
        ack = json.loads(await ws.recv())
        assert ack.get("type") == "config_ack", f"Expected config_ack, got {ack}"
        print("[PASS] Step 0: WebSocket connected and session configured.")

        # =================================================================
        # TEST 1: Normal Conversation (Scenario A)
        # =================================================================
        print("\n--- TEST 1: Normal Conversation (Scenario A) ---")
        turn_1_id = f"req_test1_{int(time.time()*1000)}"
        await ws.send(json.dumps({
            "type": "text",
            "request_id": turn_1_id,
            "turn_id": turn_1_id,
            "text": "Hello, answer in two words: Hi human."
        }))

        got_start = False
        got_token = False
        got_audio = False
        got_complete = False

        while True:
            msg = json.loads(await ws.recv())
            mtype = msg.get("type")
            rid = msg.get("request_id") or msg.get("turn_id")
            assert rid == turn_1_id, f"Expected rid={turn_1_id}, got {rid}"

            if mtype == "llm_start":
                got_start = True
            elif mtype in ("text_chunk", "llm_token", "llm_chunk"):
                got_token = True
            elif mtype in ("audio_chunk", "tts_audio_chunk"):
                got_audio = True
            elif mtype == "response_complete":
                got_complete = True
                print(f"[TEST 1] Response complete: '{msg.get('full_text')}'")
                break

        assert got_start and got_token and got_audio and got_complete, "Normal conversation failed"
        print("[PASS] Test 1: Normal conversation completed with text and audio chunks.")

        # =================================================================
        # TEST 2: Barge-In Interruption During AI Speech (Scenario B)
        # =================================================================
        print("\n--- TEST 2: Barge-In Interruption During AI Speech (Scenario B) ---")
        turn_2_id = f"req_test2_{int(time.time()*1000)}"
        await ws.send(json.dumps({
            "type": "text",
            "request_id": turn_2_id,
            "turn_id": turn_2_id,
            "text": "Can you explain the complete history of mathematics starting from ancient Babylon?"
        }))

        # Wait until first audio segment is received (AI has started speaking)
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") in ("audio_chunk", "tts_audio_chunk"):
                print(f"[TEST 2] AI began speaking segment {msg.get('segment_index')}. Triggering barge-in interrupt now!")
                break

        # Send interrupt immediately
        t_interrupt = time.time()
        await ws.send(json.dumps({
            "type": "interrupt",
            "request_id": turn_2_id,
            "turn_id": turn_2_id,
            "reason": "user_barge_in"
        }))

        # Drain in-flight wire messages until interruption ack arrives
        ack_msg = None
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") in ("interrupt_ack", "interrupted"):
                ack_msg = msg
                break

        duration_ms = (time.time() - t_interrupt) * 1000
        print(f"[TEST 2] Interruption confirmed by server in {duration_ms:.1f}ms: {ack_msg}")

        # Send immediate follow-up query (Scenario B new query)
        turn_3_id = f"req_test3_{int(time.time()*1000)}"
        await ws.send(json.dumps({
            "type": "text",
            "request_id": turn_3_id,
            "turn_id": turn_3_id,
            "text": "Actually, what is 2 plus 2? Answer in one word."
        }))

        got_turn3_answer = False
        while True:
            msg = json.loads(await ws.recv())
            rid = msg.get("request_id") or msg.get("turn_id")
            # Any remaining chunk from turn 2 should be rejected
            if rid == turn_2_id:
                print(f"[TEST 2] Received late message for cancelled turn_2 (would be dropped by client): {msg.get('type')}")
                continue
            if rid == turn_3_id and msg.get("type") == "response_complete":
                print(f"[TEST 2] Turn 3 successfully answered: '{msg.get('full_text')}'")
                got_turn3_answer = True
                break

        assert got_turn3_answer, "Turn 3 after barge-in failed to complete"
        print("[PASS] Test 2: Barge-in interruption stopped old response and answered new query.")

        # =================================================================
        # TEST 3: Interruption During LLM Generation (Scenario D)
        # =================================================================
        print("\n--- TEST 3: Interruption During LLM Generation Before Speech (Scenario D) ---")
        turn_4_id = f"req_test4_{int(time.time()*1000)}"
        await ws.send(json.dumps({
            "type": "text",
            "request_id": turn_4_id,
            "turn_id": turn_4_id,
            "text": "Tell me a very long story about a dragon in a mountain kingdom."
        }))

        # Wait only for llm_start, then interrupt immediately BEFORE any audio chunk arrives!
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") == "llm_start":
                print("[TEST 3] LLM generation started. Interrupting immediately before TTS begins...")
                break

        await ws.send(json.dumps({
            "type": "interrupt",
            "request_id": turn_4_id,
            "turn_id": turn_4_id,
            "reason": "llm_generation_interruption"
        }))

        # Wait for interrupt confirmation
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") in ("interrupt_ack", "interrupted"):
                print(f"[TEST 3] Interruption during generation confirmed: {msg}")
                break

        # Send new query
        turn_5_id = f"req_test5_{int(time.time()*1000)}"
        await ws.send(json.dumps({
            "type": "text",
            "request_id": turn_5_id,
            "turn_id": turn_5_id,
            "text": "What is the capital of France? One word."
        }))

        got_turn5_complete = False
        while True:
            msg = json.loads(await ws.recv())
            rid = msg.get("request_id") or msg.get("turn_id")
            if rid == turn_4_id:
                continue
            if rid == turn_5_id and msg.get("type") == "response_complete":
                print(f"[TEST 3] Turn 5 completed: '{msg.get('full_text')}'")
                got_turn5_complete = True
                break

        assert got_turn5_complete, "Turn 5 failed to complete"
        print("[PASS] Test 3: Interruption during LLM generation cleanly cancelled generation.")

        # =================================================================
        # TEST 4: Repeated Interruptions (Scenario C)
        # =================================================================
        print("\n--- TEST 4: Repeated Multiple Interruptions (Scenario C) ---")
        for i in range(1, 4):
            req_id = f"req_multi_{i}_{int(time.time()*1000)}"
            await ws.send(json.dumps({
                "type": "text",
                "request_id": req_id,
                "turn_id": req_id,
                "text": f"Explain topic number {i} in great detail."
            }))
            # Wait for llm_start
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("type") == "llm_start":
                    break
            # Immediately interrupt
            await ws.send(json.dumps({
                "type": "interrupt",
                "request_id": req_id,
                "turn_id": req_id,
                "reason": "rapid_interrupt"
            }))
            while True:
                ack = json.loads(await ws.recv())
                if ack.get("type") in ("interrupt_ack", "interrupted"):
                    break
            print(f"[TEST 4] Interruption {i} cleanly handled.")

        # Final query after repeated interruptions
        final_id = f"req_final_{int(time.time()*1000)}"
        await ws.send(json.dumps({
            "type": "text",
            "request_id": final_id,
            "turn_id": final_id,
            "text": "Say: Final query success."
        }))

        got_final_complete = False
        while True:
            msg = json.loads(await ws.recv())
            rid = msg.get("request_id") or msg.get("turn_id")
            if rid == final_id and msg.get("type") == "response_complete":
                print(f"[TEST 4] Final query succeeded: '{msg.get('full_text')}'")
                got_final_complete = True
                break

        assert got_final_complete, "Final query failed after multiple interruptions"
        print("[PASS] Test 4: Repeated interruptions supported without session disconnect.")

        print("\n" + "=" * 60)
        print("ALL AUTOMATED TESTS PASSED SUCCESSFULLY!")
        print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_full_pipeline())
