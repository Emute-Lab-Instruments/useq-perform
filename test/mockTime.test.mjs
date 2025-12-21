import { expect } from 'chai';
import "./setup.mjs";
import { 
    startMockTimeGenerator, 
    stopMockTimeGenerator, 
    resumeMockTimeGenerator, 
    resetMockTimeGenerator,
    getCurrentMockTime,
    isMockTimeGeneratorRunning 
} from '../src/io/mockTimeGenerator.mjs';

// Mock window and performance (if not handled by setup.mjs)
if (typeof window === 'undefined') {
    global.window = {
        performance: {
            now: () => Date.now()
        },
        requestAnimationFrame: (cb) => setTimeout(cb, 16),
        cancelAnimationFrame: (id) => clearTimeout(id)
    };
}

describe('MockTimeGenerator', () => {
    beforeEach(() => {
        resetMockTimeGenerator();
        if (isMockTimeGeneratorRunning()) stopMockTimeGenerator();
        // Force reset to 0 just in case
        resetMockTimeGenerator();
        stopMockTimeGenerator(); 
    });

    it('starts from 0', (done) => {
        startMockTimeGenerator();
        expect(isMockTimeGeneratorRunning()).to.be.true;
        expect(getCurrentMockTime()).to.be.closeTo(0, 0.1);
        
        setTimeout(() => {
            expect(getCurrentMockTime()).to.be.greaterThan(0);
            stopMockTimeGenerator();
            done();
        }, 50);
    });

    it('pauses and resumes', (done) => {
        startMockTimeGenerator();
        
        setTimeout(() => {
            stopMockTimeGenerator(); // Pause
            const pausedTime = getCurrentMockTime();
            expect(isMockTimeGeneratorRunning()).to.be.false;
            
            setTimeout(() => {
                // Ensure time hasn't changed while paused
                expect(getCurrentMockTime()).to.equal(pausedTime);
                
                resumeMockTimeGenerator();
                expect(isMockTimeGeneratorRunning()).to.be.true;
                
                setTimeout(() => {
                    expect(getCurrentMockTime()).to.be.greaterThan(pausedTime);
                    stopMockTimeGenerator();
                    done();
                }, 50);
            }, 50);
        }, 50);
    });

    it('resets to 0', (done) => {
        startMockTimeGenerator();
        setTimeout(() => {
            stopMockTimeGenerator();
            expect(getCurrentMockTime()).to.be.greaterThan(0);
            
            resetMockTimeGenerator();
            expect(getCurrentMockTime()).to.equal(0);
            done();
        }, 50);
    });
});
