# notes from the plane

- ;

- when an output is cleared (typically that means set to 0, please ensure that our value scaling/mapping strategy for continuous outputs works like "0 means output 0 volts, i.e. set the analog out to 0.5, -1 means output -5V so set the analog out to -0.5) then we have a bunch of lines drawing over each other in the middle of the serialVis oscilloscope; can we make them have dashed lines with the dashes having such phase difference that we can basically see all the colours of the lines that are zeroed out

- halos seem to glitch out when I'm typing and creating forms etc near the right edge of the screen

- I wrote this (deliberately wrong) expr to see what happened
```
(d1 (sqr bar) (sqr beat) (sqr bar) (sqr beat) (sqr bar) (sqr beat) (sqr bar))
```

I'd expect a squiggle that gives an error "output expressions only take one argument, like `(d1 (sqr bar))`

I'd also expect the formatAll action to break it up into multiple lines, because it's too long

I also think it might have caused a freeze because I got waaayy tooo many errors/warnings in console, see error-log-long-d1-line-off-screen.txt

- there seems to be some soft duplication (i.e. not exactly the same thing twice, just two or more similar actions) in the actions list

- I don't think we should pursue the "act on button down, undo if user ends up doing a hold+press chord instead" approach furthure atm because it's a power-user feature and it might be confusing, change the spec to say that and that "we will revisit later" and make sure the code doesn't have it

