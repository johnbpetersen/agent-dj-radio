#!/usr/bin/env python3

"""
Create a test audio file for debugging the music player
Generates a simple sine wave tone for testing audio playback
"""

import math
import wave
import struct

def create_test_audio(filename, duration=60, frequency=440, sample_rate=44100):
    """Create a simple sine wave audio file"""
    
    # Calculate number of samples
    num_samples = int(duration * sample_rate)
    
    # Generate sine wave samples
    samples = []
    for i in range(num_samples):
        # Simple sine wave
        time = float(i) / sample_rate
        sample = math.sin(2 * math.pi * frequency * time) * 0.3  # 30% volume
        
        # Add some variation to make it more interesting
        if i % (sample_rate // 2) == 0:  # Every 0.5 seconds
            frequency = 440 if frequency == 440 else 523  # Alternate between A and C
        
        # Convert to 16-bit integer
        sample_int = int(sample * 32767)
        samples.append(sample_int)
    
    # Write WAV file
    with wave.open(filename, 'wb') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        
        # Pack samples as signed 16-bit integers
        packed_samples = struct.pack('<' + 'h' * len(samples), *samples)
        wav_file.writeframes(packed_samples)
    
    print(f"Created test audio file: {filename}")
    print(f"Duration: {duration} seconds")
    print(f"Sample rate: {sample_rate} Hz")
    print(f"File size: {len(packed_samples)} bytes")

if __name__ == "__main__":
    # Create a 60-second test tone
    create_test_audio("public/sample-track.mp3", duration=60, frequency=440)
    print("Test audio file created successfully!")