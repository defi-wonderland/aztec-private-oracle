# Aztec Private Oracle

Aztec private oracle provides an oracle solution for those who want to keep their privacy. When asking something to a particular address (called divinity), the question and the answer is encrypted and only the requester and the divinity can read it, no other party has access to it. This allows for users to be able to ask anything they want and for the data to be priced more faily as current oracle systems publicly share their data feeds so everyone can read it for free instead of paying for every usage. 

You can check our design for the proof of concept on [Figma](https://www.figma.com/file/vf16Wx0M1ma995WEjcsx8s/Aztec-Private-Oracle?type=whiteboard&node-id=1-2&t=KjgSLbNpUGqQmsi4-4)

## Why would anyone want a private oracle?

> *and what does “private” really mean…*

Let’s naively assume you are a curious User that wants to know the answer to an arbitrary question.
On our current design, you’d choose your Divinity and create the Question. (+some payment).
After a few moments, and if your Divinity wishes, you’ll get an Answer.
But… you could’ve just googled that.

This starts making sense when we introduce a 3rd party (external contract).

Let’s say this new contract give you an NFT if you make the Divinity laugh.
*[wh4t?!. yeah trust me]*

The flow would be:

1. User creates a new private Question Note: 
    
    ```markdown
    joke: Why did the programmer quit his job? He didn't get arrays
    divinity: ToughAudience
    ```
    
2. Divinity will then create a private Answer Note for the User
    
    ```markdown
    joke: Why did the programmer quit his job? He didn't get arrays
    divinity: ToughAudience
    answer: lol
    ```
    
3. User will then retrieve and provide this Answer Note on the *YouAreFunnyNFT* contract call
    1. User → *YouAreFunnyNFT.mint()*
    2. *YouAreFunnyNFT → Oracle.getAnswerNote()*
    3. *YouAreFunnyNFT* will then validate that the returned data has the correct Divinity and “joke:” prefix.
    4. *YouAreFunnyNFT* will finally validate if the answer was indeed a “laugh”
    5. *YouAreFunnyNFT* will privately mint the NFT Note to the User.

This seems like an over-simplification, but in practice is all we need to avoid leaking privacy to external parties.

It’s important to note that the Divinity will indeed know the joke, but the *YouAreFunnyNFT* will **NOT.**

And this private Answer can be used to prove that you are funny in any other contract without having to reveal any other information.

Ok… so this is not really a “useful” use-case. But it does make a good case for the need of taking interoperability into account when designing our Oracle.

## Intallation

1) Install the Aztec Sandbox by following this [guide](https://docs.aztec.network/dev_docs/getting_started/quickstart#install-the-sandbox)

2) Install the Aztec CLI by running:
```
npm install -g @aztec/cli
```

3) To install the oracle, in the root of the project run:
```
yarn
```
## Running tests

With the sandbox running and the project installed, execute this to compile the contracts and run the tests:
```
yarn test
```

## Want to contribute?

If you have ideas on how to make the private oracle better, improve its performance or add additional features, don't hesitate to fork and send pull requests!

We also need people to test out pull requests. So take a look through the open issues and help where you want.
