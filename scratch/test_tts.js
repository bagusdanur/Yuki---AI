import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';

async function testIndoGadis() {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata('id-ID-GadisNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const text = 'Halo, aku Yuki. Kamu lagi apa? Aku lagi baca komik nih.';
    
    // Normal / cute pitch (+2Hz is very natural)
    const { audioStream } = tts.toStream(text, { pitch: '+2Hz', rate: '+0%' });
    
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', c => chunks.push(c));
      audioStream.on('end', resolve);
      audioStream.on('error', reject);
    });
    
    const buffer = Buffer.concat(chunks);
    console.log('Indonesian Gadis audio size:', buffer.length);
    fs.writeFileSync('c:/Users/kanim/Desktop/Yuki - AI/scratch/test_indo.mp3', buffer);
    console.log('Saved to scratch/test_indo.mp3');
  } catch (e) {
    console.error('Error:', e);
  }
}
testIndoGadis();
