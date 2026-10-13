import math

def is_echo_of_ai(candidate_text: str, ai_text: str) -> bool:
    """Python verification replica of static/app.js isEchoOfAi logic."""
    if not candidate_text or not ai_text:
        return False
    import re
    clean_candidate = re.sub(r'[^a-z0-9\s]', '', candidate_text.lower()).strip()
    clean_ai = re.sub(r'[^a-z0-9\s]', '', ai_text.lower()).strip()
    if not clean_candidate or not clean_ai:
        return False

    candidate_words = [w for w in clean_candidate.split() if w]
    if not candidate_words:
        return False

    ai_words_list = [w for w in clean_ai.split() if w]
    ai_words_set = set(ai_words_list)

    common_stopwords = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'it', 'its', 'you', 'your', 'i', 'my', 'we', 'our', 'and', 'or', 'but', 'hello', 'hi'}
    if len(candidate_words) == 1 and candidate_words[0] in common_stopwords and candidate_words[0] in ai_words_set:
        return True

    if len(candidate_words) >= 2 and clean_candidate in clean_ai:
        return True

    matched = sum(1 for w in candidate_words if w in ai_words_set)
    overlap = matched / len(candidate_words)
    return overlap >= 0.65

def test_anti_echo():
    ai_speech = "To learn Data Structures and Algorithms, you should first understand programming fundamentals."
    
    # Test 1: Direct speaker leak (echo of AI's words)
    assert is_echo_of_ai("programming fundamentals", ai_speech) is True, "Failed to catch direct echo"
    assert is_echo_of_ai("Data Structures and", ai_speech) is True, "Failed to catch phrase echo"
    assert is_echo_of_ai("you", ai_speech) is True, "Failed to catch stopword echo"

    # Test 2: Genuine user interruption (Scenario B)
    assert is_echo_of_ai("Actually, I want to learn Linked Lists first", ai_speech) is False, "False positive on genuine interruption"
    assert is_echo_of_ai("Wait, stop, explain trees", ai_speech) is False, "False positive on user stop command"
    assert is_echo_of_ai("Can you repeat that please", ai_speech) is False, "False positive on repeat request"
    print("[PASS] Anti-Echo unit test verified!")

def test_vad_math():
    # Test VAD RMS calculation on simulated noise vs voice
    noise_samples = [0.002 * math.sin(i) for i in range(2048)] # Ambient background noise
    voice_samples = [0.08 * math.sin(i * 0.1) for i in range(2048)] # Human voice

    rms_noise = math.sqrt(sum(s*s for s in noise_samples) / len(noise_samples))
    rms_voice = math.sqrt(sum(s*s for s in voice_samples) / len(voice_samples))

    barge_in_threshold = 0.038
    assert rms_noise < barge_in_threshold, f"Noise ({rms_noise}) incorrectly exceeded barge-in threshold"
    assert rms_voice > barge_in_threshold, f"Voice ({rms_voice}) failed to exceed barge-in threshold"
    print(f"[PASS] VAD Math verified: noise_rms={rms_noise:.4f} < {barge_in_threshold} < voice_rms={rms_voice:.4f}")

if __name__ == "__main__":
    test_anti_echo()
    test_vad_math()
