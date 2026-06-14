// Hook Voice — Speech Recognition (Whisper via Web Speech API fallback)
import { useRef, useState, useCallback } from 'react';

export function useVoice(onTranscript: (text: string) => void) {
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Trình duyệt không hỗ trợ Voice. Dùng Chrome.'); return; }

    const recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      onTranscript(transcript);
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const speak = useCallback((text: string, robotGender?: string) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'vi-VN';
    utter.rate = 0.95;
    
    // Adjust pitch based on gender preference
    // Nữ: pitch cao hơn (vd: 1.3), Nam: pitch thấp (vd: 0.8)
    utter.pitch = robotGender === 'nữ' ? 1.4 : 0.8; 
    
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => setIsSpeaking(false);

    // Chọn giọng đọc phù hợp
    const voices = window.speechSynthesis.getVoices();
    // Tiếng việt
    let viVoices = voices.filter(v => v.lang.startsWith('vi'));
    
    if (viVoices.length > 0) {
      if (robotGender === 'nữ') {
        // Cố gắng tìm giọng nữ (Microsoft HoaiMy hoặc Google)
        const femaleVoice = viVoices.find(v => v.name.toLowerCase().includes('female') || v.name.includes('HoaiMy') || v.name.includes('Google'));
        utter.voice = femaleVoice || viVoices[0];
      } else {
        // Cố gắng tìm giọng nam (Microsoft An)
        const maleVoice = viVoices.find(v => v.name.toLowerCase().includes('male') || v.name.includes('An'));
        utter.voice = maleVoice || viVoices.find(v => !v.name.includes('HoaiMy')) || viVoices[0];
      }
    }

    window.speechSynthesis.speak(utter);
  }, []);

  const cancelSpeak = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  return { isListening, isSpeaking, startListening, stopListening, speak, cancelSpeak };
}
